import type { Model, ModelConfig, ModelEvent, ModelResponse } from './model/Model';
import { OpenAIModel } from './model/OpenAIModel';
import { ClaudeModel } from './model/ClaudeModel';
import { GeminiModel } from './model/GeminiModel';
import { Message } from './chat/Message';
import { Plan } from './chat/round/Plan';
import type { ContextPatch, Tool, ToolActivity, ToolEvent, ToolResult } from './tools/tool/Tool';
import { CompressTool } from './tools/CompressTool';
import { MakePlanTool, UpdatePlanTool } from './tools/PlanTool';
import { ScheduleTool } from './tools/ScheduleTool';
import { toError } from './utils/errors';
import { logger } from './utils/logger';
import { loop } from './core/loop';

export interface CreateModelConfig extends ModelConfig {
    adapter: 'openai' | 'anthropic' | 'gemini';
}

/** agent 单次运行输入。 */
export interface AgentInput {
    messages: readonly Message[];
    signal?: AbortSignal;
}

/** agent 运行上下文。 */
export interface AgentContext {
    maxRounds?: number;
    signal?: AbortSignal;
    toolTimeoutMs?: number;
}

/** agent 事件。UI、日志、父 agent、调度工具都可以消费这个事件流。 */
export type AgentEvent =
    | { type: 'agent_start'; agent: string }
    | { type: 'model_event'; agent: string; event: ModelEvent }
    | { type: 'tool_start'; agent: string; tool: string; callId: string; label: string; activity?: ToolActivity }
    | { type: 'tool_done'; agent: string; tool: string; callId: string; label: string; result: ToolResult; activity?: ToolActivity }
    | { type: 'tool_event'; agent: string; tool: string; callId: string; label: string; event: ToolEvent }
    | { type: 'context_patch'; agent: string; tool: string; patch: ContextPatch }
    | { type: 'sub_agent_start'; agent: string; subAgent: string }
    | { type: 'sub_agent_event'; agent: string; subAgent: string; event: AgentEvent }
    | { type: 'sub_agent_done'; agent: string; subAgent: string; response?: ModelResponse }
    | { type: 'agent_done'; agent: string; response?: ModelResponse }
    | { type: 'agent_error'; agent: string; error: Error };

/**
 * 可继承的 agent 基类。
 *
 * Agent 表示“一个有目的的 AI”：它绑定一段 systemPrompt、一组 tools、
 * 可选 subAgents，并默认用标准 loop 运行。
 */
export abstract class Agent {
    abstract name: string;
    abstract systemPrompt: string;
    abstract model: Model;

    tools: Tool[] = [];
    subAgents: Agent[] = [];

    constructor(protected context: AgentContext) { }

    /**
     * 默认基础设施工具。
     *
     * 所有 Agent 自动拥有调度、上下文压缩、计划管理能力。
     * 子类可 override 来定制或排除特定默认工具。
     */
    protected defaultTools(): Tool[] {
        return [
            // new ScheduleTool(),
            // new CompressTool(),
            // new MakePlanTool(),
            // new UpdatePlanTool(),
        ];
    }

    definePlans(): Plan[] {
        return [new Plan()];
    }

    /**
     * 根据通用配置创建具体 provider 的 Model 实例。
     *
     * 这是 Agent 层的模型工厂快捷入口，只负责 adapter -> Model 子类的映射；
     * 业务侧的默认模型、模型列表、展示名等配置仍应放在具体 Agent 中。
     *
     * 用法：
     * ```ts
     * const model = Agent.createModel({
     *     adapter: 'openai',
     *     model: 'gpt-5.4',
     *     personalAccessToken: token,
     *     url: '/v1/responses',
     *     streamUrl: '/v1/responses',
     * });
     * ```
     */
    static createModel({ adapter, ...config }: CreateModelConfig): Model {
        if (adapter === 'openai') return new OpenAIModel(config);
        if (adapter === 'anthropic') return new ClaudeModel(config);
        if (adapter === 'gemini') return new GeminiModel(config);

        throw new Error(`Unknown adapter type: ${String(adapter)}`);
    }

    /**
     * 替换当前 Agent 后续运行使用的模型实例。
     *
     * 历史消息不需要跟着重建；切换模型时创建一个新的 Model 后注入即可。
     * 注意不要在一次 run() 正在执行时切换同一个 Agent 的 model。
     *
     * 用法：
     * ```ts
     * agent.changeModel(Agent.createModel({
     *     adapter: 'gemini',
     *     model: 'gemini-2.5-flash',
     *     personalAccessToken: token,
     * }));
     * ```
     */
    changeModel(model: Model): void {
        this.model = model;
    }

    /**
     * 标准 agent 运行入口。
     *
     * 子类通常只需要声明 name / systemPrompt / tools / subAgents。
     * 特殊 agent 如果需要自定义编排策略，可以覆盖此方法。
     */
    async *run(input: AgentInput): AsyncGenerator<AgentEvent, void, void> {
        yield { type: 'agent_start', agent: this.name };
        let runAssistant: Message | undefined;

        try {
            runAssistant = this.ensureCurrentAssistant(input.messages);
            const plan = runAssistant.plans[0];
            if (plan === undefined) {
                throw new Error('Agent.run() requires the pending assistant Message to have a Plan');
            }
            logger.plan(plan.toJSON());
            let finalResponse: ModelResponse | undefined;

            for await (const event of loop({
                agentName: this.name,
                model: this.model,
                maxRounds: this.context.maxRounds,
                plan,
                tools: [...this.defaultTools(), ...this.tools],
                subAgents: this.subAgents,
                system: this.systemPrompt,
                messages: input.messages,
                signal: input.signal ?? this.context.signal,
                toolTimeoutMs: this.context.toolTimeoutMs,
            })) {
                if (event.type === 'model_event' && event.event.type === 'done') {
                    if (event.event.response.responseStatus === 'final') {
                        finalResponse = event.event.response;
                    }
                }
                yield event;
            }

            const doneEvent: AgentEvent = { type: 'agent_done', agent: this.name, response: finalResponse };
            runAssistant.finish();
            plan.apply(doneEvent);
            logger.plan(plan.toJSON());
            yield doneEvent;
        } catch (error) {
            const err = toError(error);
            const errorEvent: AgentEvent = { type: 'agent_error', agent: this.name, error: err };
            runAssistant?.fail(err.message);
            const plan = runAssistant?.plans[0];
            plan?.apply(errorEvent);
            if (plan !== undefined) {
                logger.plan(plan.toJSON());
            }
            yield errorEvent;
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
     * 核心前置断言：传入的消息列表快照尾部必须是一个处于激活状态的助手消息。
     */
    private ensureCurrentAssistant(messages: readonly Message[]): Message {
        const last = messages[messages.length - 1];
        if (last?.role === 'assistant' && last.plans[0]?.status === 'pending') {
            return last;
        }
        throw new Error('Agent.run() requires messages to end with a pending assistant Message');
    }
}

