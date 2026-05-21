import { compactMessagesIfNeeded } from '../context/compaction';
import { logger } from '../utils/logger';
import { continueResponse } from './continueResponse';
import { executeToolAction } from './executeRoundTools';
import { finalizeRound } from './finalizeRound';
import { Action } from '../round/Action';
import { Round } from '../round/Round';
import type { AgentLoopOptions } from '../types';

export async function loop({
    adapter,
    history,
    system,
    maxRounds,
    signal,
    compact,
    notify,
    rounds,
    tools,
}: AgentLoopOptions): Promise<void> {
    const apiMessages = adapter.toApiMessages(history);
    const toolDefs = adapter.formatToolDefs(Object.values(tools));

    logger('agent.loop.start');

    let round = 0;
    while (round < maxRounds) {
        round++;

        if (signal !== null && signal.aborted) {
            logger('agent.loop.aborted');
            return;
        }

        const compactedApiMessages = await compactMessagesIfNeeded(apiMessages, {
            adapter,
            compact,
            system,
            signal,
            meta: { round },
        });
        if (compactedApiMessages !== null) {
            apiMessages.splice(0, apiMessages.length, ...compactedApiMessages);
        }

        logger('agent.loop.round.start');

        const responseRound = Round.fromActions([], notify ?? undefined);
        rounds.push(responseRound);
        emit(notify);

        const onStreamAction = (action: Action, kind: 'add' | 'update') => {
            if (kind === 'add') responseRound.addAction(action);
            else responseRound.touch();
        };

        let response = await adapter.chat(apiMessages, toolDefs, system, signal ?? undefined, onStreamAction);
        if (responseRound.actionCount === 0 && response.actions.length > 0) {
            responseRound.replaceActions(response.actions);
        }

        if (response.status === 'continue') {
            const continued = await continueResponse({
                adapter,
                messages: apiMessages,
                response,
                signal,
                system,
                toolDefs,
            });
            response = continued.response;
            responseRound.replaceActions(continued.round.actions);
        }

        if (response.status === 'final') {
            await finalizeRound(responseRound, {
                adapter,
                messages: apiMessages,
                system,
                signal,
            });
            responseRound.finish();

            logger('agent.loop.round.end');
            emit(notify);
            return;
        }

        if (response.status === 'tool') {
            const toolActions = responseRound.actions.filter(action => action.type === 'tool' && action.call);
            if (toolActions.length === 0) {
                throw new Error('Tool status returned without tool actions');
            }

            logger('agent.loop.round.tools');

            for (const action of toolActions) {
                const call = action.call;
                if (call === undefined) throw new Error('Tool action is missing call');

                const tool = tools[call.name];
                if (tool === undefined) throw new Error(`Unknown tool: ${call.name}`);

                const startLabel = tool.startText?.(call.input);
                action.label = typeof startLabel === 'string' && startLabel.length > 0
                    ? startLabel
                    : call.name;
            }

            apiMessages.push(response.raw);
            emit(notify);

            const toolResultMessages = await Promise.all(toolActions.map(async action => {
                const result = await executeToolAction(tools, action);
                const call = action.call;
                if (call === undefined) throw new Error('Tool action is missing call');

                call.result = result.result;

                const tool = tools[call.name];
                if (tool === undefined) throw new Error(`Unknown tool: ${call.name}`);

                if (result.event !== undefined) action.event = result.event;
                if (result.event !== undefined) {
                    const endLabel = tool.endText?.(result.event, call.input);
                    action.label = typeof endLabel === 'string' && endLabel.length > 0
                        ? endLabel
                        : call.name;
                } else {
                    action.label = call.name;
                }

                action.done = true;
                emit(notify);

                return adapter.createToolResultMsg(call.id, result.result);
            }));

            responseRound.finish();
            apiMessages.push(...toolResultMessages);

            continue;
        }

        throw new Error(`Unsupported adapter response status: ${String(response.status)}`);
    }

    logger('agent.loop.maxRoundsExhausted');
    const exhaustedRound = Round.fromActions([
        new Action({
            type: 'content',
            content: '工具调用次数过多，已停止继续执行。',
        }),
    ], notify ?? undefined);
    exhaustedRound.finish();
    rounds.push(exhaustedRound);
    emit(notify);
}

function emit(notify: AgentLoopOptions['notify']): void {
    try {
        if (notify !== null) notify();
    } catch (error) {
        logger('agent.loop.notify.error', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
