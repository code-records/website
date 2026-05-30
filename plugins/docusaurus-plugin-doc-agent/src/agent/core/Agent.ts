import type { Model, ModelConfig, ModelResponse } from '../model/Model';
import { ClaudeModel } from '../model/ClaudeModel';
import { GeminiModel } from '../model/GeminiModel';
import { OpenAIModel } from '../model/OpenAIModel';
import type { Tool } from '../tools/tool/Tool';
import { toError } from '../utils/errors';
import { logger } from '../utils/logger';
import { loop } from './loop';
import { AgentResult } from './AgentResult';
import { Context } from './Context';
import type { AgentEvent } from './type';

export interface CreateModelConfig extends ModelConfig {
    adapter: 'openai' | 'anthropic' | 'gemini';
}

export type AgentInput = string | Context | AgentRunOptions;

export interface AgentRunOptions {
    context: Context;
    result?: AgentResult;
    signal?: AbortSignal;
}

export interface AgentOutput {
    content: string;
    result: AgentResult;
    response?: ModelResponse;
}

export interface AgentContext {
    maxRounds?: number;
    signal?: AbortSignal;
    toolTimeoutMs?: number;
}

interface PreparedAgentRun {
    context: Context;
    result: AgentResult;
    signal?: AbortSignal;
}

export abstract class Agent {
    abstract name: string;
    abstract systemPrompt: string;
    abstract model: Model;

    tools: Tool[] = [];
    subAgents: Agent[] = [];

    constructor(protected context: AgentContext = {}) { }

    protected defaultTools(): Tool[] {
        return [];
    }

    static createModel({ adapter, ...config }: CreateModelConfig): Model {
        if (adapter === 'openai') return new OpenAIModel(config);
        if (adapter === 'anthropic') return new ClaudeModel(config);
        if (adapter === 'gemini') return new GeminiModel(config);

        throw new Error(`Unknown adapter type: ${String(adapter)}`);
    }

    changeModel(model: Model): void {
        this.model = model;
    }

    async *run(input: AgentInput): AsyncGenerator<AgentEvent, void, void> {
        const prepared = this.prepareRun(input);
        for await (const event of this.runPrepared(prepared)) {
            yield event;
        }
    }

    async generate(input: AgentInput): Promise<AgentOutput> {
        const prepared = this.prepareRun(input);
        let response: ModelResponse | undefined;

        for await (const event of this.runPrepared(prepared)) {
            if (event.type === 'agent_done') {
                response = event.response;
            }
            if (event.type === 'agent_error') {
                throw event.error;
            }
        }

        return {
            content: prepared.result.content,
            result: prepared.result,
            response,
        };
    }

    async ask(input: string, signal?: AbortSignal): Promise<string> {
        return (await this.generate({ context: Context.from(input), signal })).content;
    }

    private async *runPrepared(prepared: PreparedAgentRun): AsyncGenerator<AgentEvent, void, void> {
        yield { type: 'agent_start', agent: this.name };

        try {
            let finalResponse: ModelResponse | undefined;

            for await (const event of loop({
                agentName: this.name,
                context: prepared.context,
                maxRounds: this.context.maxRounds,
                model: this.model,
                signal: prepared.signal,
                subAgents: this.subAgents,
                system: this.systemPrompt,
                toolTimeoutMs: this.context.toolTimeoutMs,
                tools: [...this.defaultTools(), ...this.tools],
                agentResult: prepared.result,
            })) {
                if (event.type === 'model_event' && event.event.type === 'done' && event.event.response.responseStatus === 'final') {
                    finalResponse = event.event.response;
                }
                yield event;
            }

            prepared.result.complete();
            logger.flow(prepared.result.toJSON());
            yield { type: 'agent_done', agent: this.name, response: finalResponse };
        } catch (error) {
            const err = toError(error);
            const errorEvent: AgentEvent = { type: 'agent_error', agent: this.name, error: err };
            prepared.result.apply(errorEvent);
            logger.flow(prepared.result.toJSON());
            yield errorEvent;
        }
    }

    private prepareRun(input: AgentInput): PreparedAgentRun {
        const options = typeof input === 'string' || input instanceof Context
            ? { context: Context.from(input) }
            : input;
        const context = options.context.clone();
        if (context.messages.length === 0) {
            throw new Error('Agent context must contain at least one message');
        }

        const result = options.result ?? new AgentResult();
        return {
            context,
            result,
            signal: options.signal ?? this.context.signal,
        };
    }
}
