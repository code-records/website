import type { AgentEvent } from '../Agent';
import type { Agent } from '../Agent';
import { Message } from '../chat/Message';
import type { Flow } from '../chat/round/Flow';
import type { Round } from '../chat/round/Round';
import type { Model, ModelToolCall } from '../model/Model';
import type { Tool, ToolResult, ToolUsage } from '../tools/tool/Tool';
import { ToolManager } from '../tools/tool/ToolManager';
import { logger } from '../utils/logger';
import { applyContextPatch, createAskFactory, toAgentModelEvent } from './helper';

export interface LoopOptions {
    agentName?: string;
    maxRounds?: number;
    messages: readonly Message[];
    model: Model;
    flow: Flow;
    signal?: AbortSignal;
    subAgents?: Agent[];
    system: string;
    toolTimeoutMs?: number;
    tools: Tool[];
}

interface SettledToolCall {
    call: ModelToolCall;
    label: string;
    result: ToolResult;
    token: symbol;
    tool: string;
    usage?: ToolUsage;
}

export async function* loop(options: LoopOptions): AsyncGenerator<AgentEvent, void, void> {
    const {
        agentName = 'agent',
        maxRounds = 16,
        model,
        flow,
        signal,
        subAgents = [],
        system,
        toolTimeoutMs,
        tools,
    } = options;

    let runMessages = [...options.messages];
    const createAsk = createAskFactory({ model, signal, system });
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

    for (let count = 1; count <= maxRounds && !signal?.aborted; count++) {
        let round: Round | undefined;

        for await (const event of model.stream({
            system,
            messages: runMessages,
            tools: toolManager.definitions(),
            signal,
        })) {
            const agentEvent = toAgentModelEvent(agentName, event);
            round = flow.apply(agentEvent) ?? round;
            if (round !== undefined) {
                round.count = count;
                updateToolActionLabels(round, toolManager);
                loggerRoundStart(round, loggedRoundStarts);
                loggerRoundAction(round);
            }
            yield agentEvent;

            if (event.type === 'error') {
                throw event.error;
            }
        }

        if (round === undefined || round.type === undefined) {
            throw new Error('Model.stream() ended without updating the current round type');
        }

        const toolCalls = getRoundToolCalls(round);

        if (round.type === 'final') {
            round.complete();
            loggerRoundDone(round);
            return;
        }

        if (round.type === 'continue') {
            round.complete();
            loggerRoundDone(round);
            runMessages = [...runMessages, Message.user('\u7ee7\u7eed\u5b8c\u6210\u4e0a\u4e00\u8f6e\u672a\u5b8c\u6210\u7684\u4efb\u52a1\u3002\u82e5\u9700\u8981\u5de5\u5177\uff0c\u8bf7\u76f4\u63a5\u8c03\u7528\u5de5\u5177\uff1b\u5426\u5219\u76f4\u63a5\u7eed\u5199\u6700\u7ec8\u56de\u7b54\uff0c\u4e0d\u8981\u53ea\u8bf4\u660e\u4f60\u5c06\u7ee7\u7eed\u3002')];
            continue;
        }

        if (round.type === 'tool_calls') {
            if (toolCalls.length === 0) {
                throw new Error('Model returned tool_calls response without tool calls');
            }

            const pending: Array<{
                promise: Promise<SettledToolCall>;
                token: symbol;
            }> = [];

            for (const call of toolCalls) {
                toolManager.require(call.name);
                const label = toolManager.formatLabel(call);
                const usage = toolManager.formatUsage(call);

                const toolStartEvent: AgentEvent = {
                    type: 'tool_start',
                    agent: agentName,
                    callId: call.id,
                    label,
                    tool: call.name,
                    usage,
                };
                flow.apply(toolStartEvent);
                yield toolStartEvent;

                const token = Symbol(call.id);
                pending.push({
                    token,
                    promise: toolManager.runCallRecord(call).then(record => ({
                        call,
                        label,
                        result: record.result,
                        token,
                        tool: call.name,
                        usage,
                    })),
                });
            }

            while (pending.length > 0) {
                const settled = await Promise.race(pending.map(item => item.promise));
                const index = pending.findIndex(item => item.token === settled.token);
                if (index >= 0) pending.splice(index, 1);

                const { call, label, result, tool, usage } = settled;

                const toolDoneEvent: AgentEvent = {
                    type: 'tool_done',
                    agent: agentName,
                    callId: call.id,
                    label,
                    result,
                    tool,
                    usage: result.usage ?? usage,
                };
                flow.apply(toolDoneEvent);
                yield toolDoneEvent;

                for (const event of result.events ?? []) {
                    const toolEvent: AgentEvent = {
                        type: 'tool_event',
                        agent: agentName,
                        callId: call.id,
                        event,
                        label,
                        tool,
                    };
                    flow.apply(toolEvent);
                    yield toolEvent;
                }

                if (result.contextPatch !== undefined) {
                    runMessages = applyContextPatch(runMessages, result.contextPatch);
                    toolManager.setContext(runMessages);
                    const contextPatchEvent: AgentEvent = {
                        type: 'context_patch',
                        agent: agentName,
                        patch: result.contextPatch,
                        tool,
                    };
                    flow.apply(contextPatchEvent);
                    yield contextPatchEvent;
                }
            }

            round.complete();
            loggerRoundDone(round);
            continue;
        }

        throw new Error(`Unsupported model response type: ${round.type}`);
    }

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
            round.updateToolUsage(call.id, toolManager.formatUsage(call));
        } catch {
            // The loop will surface missing tools when it tries to execute the call.
        }
    }
}
