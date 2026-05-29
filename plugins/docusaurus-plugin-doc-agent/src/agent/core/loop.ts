import type { AgentEvent } from '../Agent';
import type { Agent } from '../Agent';
import { Message } from '../chat/Message';
import type { Plan } from '../chat/round/Plan';
import type { Round } from '../chat/round/Round';
import type { Model } from '../model/Model';
import type { ModelToolCall } from '../model/Model';
import type { Tool, ToolActivity, ToolResult } from '../tools/tool/Tool';
import { ToolManager } from '../tools/tool/ToolManager';
import { applyContextPatch, createAskFactory, toAgentModelEvent } from './helper';
import { logger } from '../utils/logger';

// ─── 类型 (公开 API) ───────────────────────────────────

export interface LoopOptions {
    agentName?: string;
    maxRounds?: number;
    messages: readonly Message[];
    model: Model;
    plan: Plan;
    signal?: AbortSignal;
    subAgents?: Agent[];
    system: string;
    toolTimeoutMs?: number;
    tools: Tool[];
}

// ─── 类型 (内部实现私有) ─────────────────────────────────

// 一个工具调用 promise 已完成
interface SettledToolCall {
    activity?: ToolActivity;
    call: ModelToolCall;
    label: string;
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
        plan,
        signal,
        subAgents = [],
        system,
        toolTimeoutMs,
        tools,
    } = options;

    // 1. 本次运行使用 Message 引用作为状态源；临时追加只影响当前 run。
    let runMessages = [...options.messages];

    // 2. 创建工具回问 model 的闭包；具体工具执行前会注入。
    const createAsk = createAskFactory({ model, signal, system });

    // 3. 工具查找、sub-agent 包装、runner 构建都收敛在 ToolManager。
    const toolManager = new ToolManager({
        context: runMessages,
        createAsk,
        defaultTimeoutMs: toolTimeoutMs,
        model,
        signal,
        subAgents,
        tools,
    });

    const loggedRoundStarts = new WeakSet<Round>();

    // 4. 一轮 round = 一次 model 调用，以及可能跟随的一批工具执行。
    for (let count = 1; count <= maxRounds && !signal?.aborted; count++) {
        let round: Round | undefined;
        // 5. 把当前完整上下文交给 model；model 永远以统一事件流返回。
        for await (const event of model.stream({
            system,
            messages: runMessages,
            tools: toolManager.definitions(),
            signal,
        })) {
            // 6. 先把 model 事件透传给上层 UI/日志，让界面可以实时更新。
            const agentEvent = toAgentModelEvent(agentName, event);
            round = plan.apply(agentEvent) ?? round;
            if (round !== undefined) {
                round.count = count;
                updateToolActionLabels(round, toolManager);
                loggerRoundStart(round, loggedRoundStarts);
                loggerRoundAction(round);
            }
            yield agentEvent;

            // 8. done 表示本轮 model 输出结束；保存状态、raw 消息和最终 actions。
            // 9. model 明确报错时，中断 loop，让 Agent.run 包装成 agent_error。
            if (event.type === 'error') {
                throw event.error;
            }
        }

        if (round === undefined || round.status === undefined) {
            throw new Error('Model.stream() ended without updating the current round status');
        }

        // 10. 从本轮 round 中提取工具调用；loop 只执行 tool action。
        const toolCalls = getRoundToolCalls(round);

        // 11. final 表示模型已经给出最终回复，本次 agent loop 结束。
        if (round.status === 'final') {
            round.finish();
            loggerRoundDone(round);
            return;
        }

        // 12. continue 表示模型输出被截断，或只产出了过渡说明；追加明确续跑指令让模型继续。
        if (round.status === 'continue') {
            round.finish();
            loggerRoundDone(round);
            runMessages = [...runMessages, Message.user('继续完成上一轮未完成的任务。若需要工具，请直接调用工具；否则直接续写最终回答，不要只说明你将继续。')];
            continue;
        }

        // 13. tool 表示模型要求执行工具；先把 assistant 的 raw 写入上下文。
        if (round.status === 'tool_calls') {
            if (toolCalls.length === 0) {
                throw new Error('Model returned tool_calls response without tool calls');
            }

            // 14. 启动全部工具调用；这里先发 tool_start，再并发等待结果。
            const pending: Array<{
                promise: Promise<SettledToolCall>;
                token: symbol;
            }> = [];

            for (const call of toolCalls) {
                // 15. 先确认工具存在；实际 ask 注入和执行交给 ToolManager。
                toolManager.require(call.name);
                const label = toolManager.formatLabel(call);
                const activity = toolManager.formatActivity(call);

                const toolStartEvent: AgentEvent = {
                    type: 'tool_start',
                    activity,
                    agent: agentName,
                    callId: call.id,
                    label,
                    tool: call.name,
                };
                plan.apply(toolStartEvent);
                yield toolStartEvent;

                // 16. 每个工具拿到同一时刻的上下文快照；完成顺序可以不同。
                const token = Symbol(call.id);
                pending.push({
                    token,
                    promise: toolManager.runCallRecord(call).then(record => ({
                        activity,
                        call,
                        label,
                        result: record.result,
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

                const { activity, call, label, result, tool } = settled;

                // 18. 通知工具完成；UI 可以更新对应 action 的状态和展示文本。
                const toolDoneEvent: AgentEvent = {
                    type: 'tool_done',
                    activity: result.activity ?? activity,
                    agent: agentName,
                    callId: call.id,
                    label,
                    result,
                    tool,
                };
                plan.apply(toolDoneEvent);
                yield toolDoneEvent;

                // 19. 工具可返回额外事件，例如搜索结果、文件变更、调度状态等。
                for (const event of result.events ?? []) {
                    const toolEvent: AgentEvent = {
                        type: 'tool_event',
                        agent: agentName,
                        callId: call.id,
                        event,
                        label,
                        tool,
                    };
                    plan.apply(toolEvent);
                    yield toolEvent;
                }

                // 20. 工具如需改写上下文，统一通过 contextPatch 交给 loop 应用。
                if (result.contextPatch !== undefined) {
                    runMessages = applyContextPatch(runMessages, result.contextPatch);
                    toolManager.setContext(runMessages);
                    const contextPatchEvent: AgentEvent = {
                        type: 'context_patch',
                        agent: agentName,
                        patch: result.contextPatch,
                        tool,
                    };
                    plan.apply(contextPatchEvent);
                    yield contextPatchEvent;
                }

                // 21. 工具结果通过 tool_done 事件写入当前 assistant round；下一轮 model 从 Message 读取。
            }

            // 22. 工具结果已写回上下文，进入下一轮 model 调用。
            round.finish();
            loggerRoundDone(round);
            continue;
        }

        // 23. 防御未知状态，避免静默退出或死循环。
        throw new Error(`Unsupported model response status: ${round.status}`);
    }

    // 24. 超过最大轮数通常说明模型一直在请求工具或续写。
    throw new Error(`Agent loop exceeded maxRounds=${maxRounds}`);
}

function getRoundToolCalls(round: Round): ModelToolCall[] {
    return round.actions
        .map(action => action.call)
        .filter((call): call is ModelToolCall => call !== undefined);
}

function loggerRoundDone(round: Round): void {
    logger.round(round.toJSON());
}

function loggerRoundStart(round: Round, loggedRoundStarts: WeakSet<Round>): void {
    if (loggedRoundStarts.has(round)) return;
    loggedRoundStarts.add(round);
    logger.round(round.toJSON());
}

function loggerRoundAction(round: Round): void {
    const action = round.actions[round.actions.length - 1];
    if (action === undefined) return;
    if (action.type === 'thinking') return;
    logger.action(action.toJSON());
}

function updateToolActionLabels(round: Round, toolManager: ToolManager): void {
    for (const action of round.actions) {
        const call = action.call;
        if (action.type !== 'tool' || call === undefined) continue;
        try {
            const label = toolManager.formatLabel(call);
            round.updateToolLabel(call.id, label);
            round.updateToolActivity(call.id, toolManager.formatActivity(call));
        } catch {
            // The loop will surface missing tools when it tries to execute the call.
        }
    }
}


