import type { Model, ModelEvent, ModelResponse } from './model/Model';
import { Message } from './chat/Message';
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
        let runAssistant: Message | undefined;

        try {
            runAssistant = this.ensureCurrentAssistant(input.messages);
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
                this.applyEventToAssistantMessage(runAssistant, event);
                if (event.type === 'model_event' && event.event.type === 'done') {
                    response = event.event.response;
                }
                yield event;
            }

            if (runAssistant.content.length === 0 && response?.content) {
                runAssistant.content = response.content;
            }
            runAssistant.finish();
            runAssistant.plan?.apply({ type: 'agent_done', agent: this.name, response });
            yield { type: 'agent_done', agent: this.name, response };
        } catch (error) {
            const err = toError(error);
            runAssistant?.fail(err.message);
            runAssistant?.plan?.apply({ type: 'agent_error', agent: this.name, error: err });
            yield { type: 'agent_error', agent: this.name, error: err };
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
    /**
     * 获取并校验当前正在运行的 assistant 消息。
     * 核心前置断言：传入的消息列表快照尾部必须是一个处于激活状态（isActive）的助手消息。
     */
    private ensureCurrentAssistant(messages: readonly Message[]): Message {
        const last = messages[messages.length - 1];
        if (last?.role === 'assistant' && last.plan?.isActive === true) {
            return last;
        }
        throw new Error('Agent.run() requires messages to end with an active assistant Message');
    }

    /**
     * 将 Agent 运行时事件应用到当前的助理消息中。
     * 用以就地（in-place）累积 content 并回放事件以推进其 Plan/Round/Action 状态。
     */
    private applyEventToAssistantMessage(assistant: Message, event: AgentEvent): void {
        assistant.plan?.apply(event);
        if (event.type === 'model_event' && event.event.type === 'content_delta') {
            assistant.content += event.event.content;
        }
    }

}
