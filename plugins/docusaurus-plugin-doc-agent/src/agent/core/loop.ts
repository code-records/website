import type { Agent } from './Agent';
import type { Context } from './Context';
import type { AgentResult } from './AgentResult';
import type { Round } from './Round';
import type { AgentEvent } from './type';
import type { Model, ModelToolCall } from '../model/Model';
import type { Tool, ToolResult, ToolUsage } from '../tools/tool/Tool';
import { ToolManager } from '../tools/tool/ToolManager';
import { logger } from '../utils/logger';
import { applyContextPatch, createAskFactory, toAgentModelEvent } from './helper';

export interface LoopOptions {
    agentName?: string;
    context: Context;
    maxRounds?: number;
    model: Model;
    signal?: AbortSignal;
    subAgents?: Agent[];
    system: string;
    toolTimeoutMs?: number;
    tools: Tool[];
    agentResult: AgentResult;
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
        context,
        maxRounds = 16,
        model,
        signal,
        subAgents = [],
        system,
        toolTimeoutMs,
        tools,
        agentResult,
    } = options;

    let runContext = context.clone();
    let continuation = '';
    const createAsk = createAskFactory({ model, signal, system });
    const toolManager = new ToolManager({
        context: runContext,
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
            context: runContext,
            continuation,
            result: agentResult,
            system,
            tools: toolManager.definitions(),
            signal,
        })) {
            const agentEvent = toAgentModelEvent(agentName, event);
            round = agentResult.apply(agentEvent) ?? round;
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
            continuation = '继续完成上一轮未完成的任务。若需要工具，请直接调用工具；否则直接续写最终回答，不要只说明你将继续。';
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
                agentResult.apply(toolStartEvent);
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
                agentResult.apply(toolDoneEvent);
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
                    agentResult.apply(toolEvent);
                    yield toolEvent;
                }

                if (result.contextPatch !== undefined) {
                    runContext = applyContextPatch(runContext, result.contextPatch);
                    toolManager.setContext(runContext);
                    const contextPatchEvent: AgentEvent = {
                        type: 'context_patch',
                        agent: agentName,
                        patch: result.contextPatch,
                        tool,
                    };
                    agentResult.apply(contextPatchEvent);
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
    return round.steps
        .map(step => step.call)
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
    const step = round.steps[round.steps.length - 1];
    if (step === undefined) return;
    if (step.type === 'thinking') return;
    logger.action(step.toJSON());
}

function updateToolActionLabels(round: Round, toolManager: ToolManager): void {
    for (const step of round.steps) {
        const call = step.call;
        if (step.type !== 'tool' || call === undefined) continue;
        try {
            const label = toolManager.formatLabel(call);
            round.updateToolLabel(call.id, label);
            round.updateToolUsage(call.id, toolManager.formatUsage(call));
        } catch {
            // The loop will surface missing tools when it tries to execute the call.
        }
    }
}
