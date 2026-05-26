import type { Model, ModelEvent, ModelResponse } from './model/Model';
import type { Message } from './chat/Message';
import type { ContextPatch, Tool, ToolEvent, ToolResult } from './tools/tool/Tool';
import { toError } from './utils/errors';
import { loop } from './core/loop';

/** agent 单次运行输入。 */
export interface AgentInput {
    messages: readonly Message[];
    signal?: AbortSignal;
}

/** agent 运行上下文。 */
export interface AgentContext {
    maxRounds?: number;
    model: Model;
    signal?: AbortSignal;
    toolTimeoutMs?: number;
}

/** agent 事件。UI、日志、父 agent、调度工具都可以消费这个事件流。 */
export type AgentEvent =
    | { type: 'agent_start'; agent: string }
    | { type: 'model_event'; agent: string; event: ModelEvent }
    | { type: 'tool_start'; agent: string; tool: string; callId: string }
    | { type: 'tool_done'; agent: string; tool: string; callId: string; result: ToolResult }
    | { type: 'tool_event'; agent: string; tool: string; event: ToolEvent }
    | { type: 'context_patch'; agent: string; tool: string; patch: ContextPatch }
    | { type: 'sub_agent_start'; agent: string; subAgent: string }
    | { type: 'sub_agent_event'; agent: string; subAgent: string; event: AgentEvent }
    | { type: 'sub_agent_done'; agent: string; subAgent: string; response?: ModelResponse }
    | { type: 'agent_done'; agent: string; response?: ModelResponse }
    | { type: 'agent_error'; agent: string; error: Error };

/**
 * 可继承的 agent 基类。
 *
 * Agent 表示“一个有目的的 AI”：它绑定一段 instructions、一组 tools、
 * 可选 subAgents，并默认用标准 loop 运行。
 */
export abstract class Agent {
    abstract name: string;
    abstract instructions: string;

    tools: Tool[] = [];
    subAgents: Agent[] = [];

    constructor(protected context: AgentContext) { }

    setModel(model: Model): void {
        this.context.model = model;
    }

    /**
     * 标准 agent 运行入口。
     *
     * 子类通常只需要声明 name / instructions / tools / subAgents。
     * 特殊 agent 如果需要自定义编排策略，可以覆盖此方法。
     */
    async *run(input: AgentInput): AsyncGenerator<AgentEvent, void, void> {
        yield { type: 'agent_start', agent: this.name };

        try {
            let response: ModelResponse | undefined;

            for await (const event of loop({
                agentName: this.name,
                model: this.context.model,
                maxRounds: this.context.maxRounds,
                tools: this.tools,
                subAgents: this.subAgents,
                system: this.instructions,
                messages: input.messages,
                signal: input.signal ?? this.context.signal,
                toolTimeoutMs: this.context.toolTimeoutMs,
            })) {
                if (event.type === 'model_event' && event.event.type === 'done') {
                    response = event.event.response;
                }
                yield event;
            }

            yield { type: 'agent_done', agent: this.name, response };
        } catch (error) {
            yield { type: 'agent_error', agent: this.name, error: toError(error) };
        }
    }

    /**
     * 非流式便捷入口，由 run() 聚合而来。
     */
    async complete(input: AgentInput): Promise<ModelResponse | undefined> {
        let response: ModelResponse | undefined;

        for await (const event of this.run(input)) {
            if (event.type === 'agent_done') {
                response = event.response;
            }
            if (event.type === 'agent_error') {
                throw event.error;
            }
        }

        return response;
    }
}
