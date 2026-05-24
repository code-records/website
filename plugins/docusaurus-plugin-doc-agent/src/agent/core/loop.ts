import type { AgentEvent } from '../Agent';
import type { Agent } from '../Agent';
import type { Model, ModelAction, ModelEvent, ModelMessage, ToolCall } from '../model/Model';
import type { AskModel, Tool, ToolResult } from '../tools/Tool';
import { ToolRegistry } from '../tools/ToolRegistry';
import { SubAgentTool } from '../tools/SubAgentTool';
import { Context } from './Context';
import { executeToolCall } from './executeToolCall';

// ─── 类型 ───────────────────────────────────────────

export interface LoopOptions {
    agentName?: string;
    context: ModelMessage[];
    maxRounds?: number;
    model: Model;
    signal?: AbortSignal;
    subAgents?: Agent[];
    system: string;
    toolTimeoutMs?: number;
    tools: Tool[];
}

interface ToolExecutionResult {
    call: ToolCall;
    result: ToolResult;
    token: symbol;
    tool: string;
}

// ─── 主循环 ──────────────────────────────────────────

/**
 * 核心编排循环：驱动 model ↔ tools ↔ sub-agents 的交互。
 */
export async function* loop(options: LoopOptions): AsyncGenerator<AgentEvent, void, void> {
    const {
        agentName = 'agent',
        maxRounds = 16,
        model,
        signal,
        subAgents = [],
        system,
        toolTimeoutMs,
        tools,
    } = options;

    // 1. 建立本次运行的上下文副本；loop 后续只改这个 Context。
    const context = new Context(options.context);

    // 2. 合并普通工具和 sub-agent 工具，并生成运行时工具表。
    const runtimeTools = subAgents.length > 0
        ? [...tools, new SubAgentTool({ subAgents })]
        : tools;
    const toolRegistry = new ToolRegistry(runtimeTools);

    // 3. 创建工具回问 model 的闭包；具体工具执行前会注入。
    const createAsk = createAskFactory({ model, signal, system });

    // 4. 一轮 round = 一次 model 调用，以及可能跟随的一批工具执行。
    for (let round = 0; round < maxRounds && !signal?.aborted; round++) {
        const actions: ModelAction[] = [];
        const toolCalls: ToolCall[] = [];
        let status: 'tool' | 'continue' | 'final' = 'final';
        let raw: ModelMessage | undefined;

        // 5. 把当前完整上下文交给 model；model 永远以统一事件流返回。
        for await (const event of model.stream({
            system,
            messages: context.toModelMessages(),
            tools: toolRegistry.definitions(),
            signal,
        })) {
            // 6. 先把 model 事件透传给上层 UI/日志，让界面可以实时更新。
            yield toAgentModelEvent(agentName, event);

            // 7. thinking/tool 这类动作进入本轮 actions；content 仍走 content_delta。
            if (event.type === 'action') {
                mergeAction(actions, event.action);
            }

            // 8. done 表示本轮 model 输出结束；保存状态、raw 消息和最终 actions。
            if (event.type === 'done') {
                status = event.response.status;
                raw = event.response.raw;
                actions.splice(0, actions.length, ...event.response.actions);
            }

            // 9. model 明确报错时，中断 loop，让 Agent.run 包装成 agent_error。
            if (event.type === 'error') {
                throw event.error;
            }
        }

        // 10. 从本轮 actions 中提取工具调用；loop 只执行 tool action。
        toolCalls.push(...actions
            .filter((action): action is Extract<ModelAction, { type: 'tool' }> => action.type === 'tool')
            .map(action => action.call));

        // 11. final 表示模型已经给出最终回复，本次 agent loop 结束。
        if (status === 'final') {
            return;
        }

        // 12. continue 表示模型输出被截断；写回 raw，并追加“继续”让模型续写。
        if (status === 'continue') {
            if (raw !== undefined) {
                context.append([raw]);
            }
            context.append([model.createUserMsg('继续')]);
            continue;
        }

        // 13. tool 表示模型要求执行工具；先把 assistant 的 raw 写入上下文。
        if (status === 'tool') {
            if (raw !== undefined) {
                context.append([raw]);
            }
            if (toolCalls.length === 0) {
                throw new Error('Model returned tool status without tool calls');
            }

            // 14. 启动全部工具调用；这里先发 tool_start，再并发等待结果。
            const pending: Array<{
                promise: Promise<ToolExecutionResult>;
                token: symbol;
            }> = [];

            for (const call of toolCalls) {
                // 15. 找到工具并注入 ask 能力，让工具可在边界场景回问 model。
                const tool = toolRegistry.require(call.name);
                tool.setAsk(createAsk(call.name));

                yield {
                    type: 'tool_start',
                    agent: agentName,
                    callId: call.id,
                    tool: call.name,
                };

                // 16. 每个工具拿到同一时刻的上下文快照；完成顺序可以不同。
                const token = Symbol(call.id);
                pending.push({
                    token,
                    promise: executeToolCall(call, {
                        context: context.snapshot(),
                        createAsk,
                        model,
                        registry: toolRegistry,
                        signal,
                        timeoutMs: toolTimeoutMs,
                    }).then(result => ({
                        call,
                        result,
                        token,
                        tool: call.name,
                    })),
                });
            }

            // 17. 谁先完成就先处理谁，并把工具结果实时通知给上层。
            while (pending.length > 0) {
                const settled = await Promise.race(pending.map(item => item.promise));
                const index = pending.findIndex(item => item.token === settled.token);
                if (index >= 0) pending.splice(index, 1);

                const { call, result, tool } = settled;

                // 18. 通知工具完成；UI 可以更新对应 action 的状态和展示文本。
                yield {
                    type: 'tool_done',
                    agent: agentName,
                    callId: call.id,
                    result,
                    tool,
                };

                // 19. 工具可返回额外事件，例如搜索结果、文件变更、调度状态等。
                for (const event of result.events ?? []) {
                    yield {
                        type: 'tool_event',
                        agent: agentName,
                        event,
                        tool,
                    };
                }

                // 20. 工具如需改写上下文，统一通过 contextPatch 交给 loop 应用。
                if (result.contextPatch !== undefined) {
                    context.apply(result.contextPatch);
                    yield {
                        type: 'context_patch',
                        agent: agentName,
                        patch: result.contextPatch,
                        tool,
                    };
                }

                // 21. 工具结果必须写回模型上下文，下一轮 model 才知道工具返回了什么。
                context.append([
                    model.createToolResultMsg(call.id, result.result),
                ]);
            }

            // 22. 工具结果已写回上下文，进入下一轮 model 调用。
            continue;
        }

        // 23. 防御未知状态，避免静默退出或死循环。
        throw new Error(`Unsupported model response status: ${status}`);
    }

    // 24. 超过最大轮数通常说明模型一直在请求工具或续写。
    throw new Error(`Agent loop exceeded maxRounds=${maxRounds}`);
}

function createAskFactory({
    model,
    signal,
    system,
}: {
    model: Model;
    signal?: AbortSignal;
    system: string;
}): (toolName: string) => AskModel {
    return (toolName: string): AskModel => {
        return async (request) => {
            // 工具回问使用独立的一次 complete，并禁用工具避免递归工具调用。
            const response = await model.complete({
                system: `${system}\n\nCurrent tool: ${toolName}`,
                messages: [model.createUserMsg(request.prompt.build(request.input))],
                toolChoice: 'none',
                signal,
            });
            return request.prompt.parse(response.content);
        };
    };
}

function toAgentModelEvent(agentName: string, event: ModelEvent): AgentEvent {
    // ModelEvent 是模型层事件；AgentEvent 补上 agent 名，方便 UI/父 agent 区分来源。
    return {
        type: 'model_event',
        agent: agentName,
        event,
    };
}

function mergeAction(actions: ModelAction[], action: ModelAction): void {
    // tool action 可能先 add 再 update；用 call.id 覆盖同一个工具调用。
    if (action.type === 'tool') {
        const index = actions.findIndex(item => item.type === 'tool' && item.call.id === action.call.id);
        if (index >= 0) {
            actions[index] = action;
            return;
        }
    }

    // thinking action 目前按事件顺序追加；是否合并由 UI Round 层处理。
    actions.push(action);
}
