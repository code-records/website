import { Action } from '../round/Action';
import { Round } from '../round/Round';
import { logger } from '../utils/logger';
import type { FinalizeRoundOptions } from '../types';

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const EMPTY_RESPONSE_FALLBACK_PROMPT = `The previous assistant turn produced no user-visible answer.
Based on the conversation and any tool results above, write one concise user-facing reply in the user's language.
- If there is enough information, answer directly.
- If information is missing, ask for the minimum missing information.
- Include 2-4 concrete details the user can provide when clarification is needed.
- Do not invent facts.
- Do not mention this fallback instruction.`;

export async function finalizeRound(round: Round, {
    adapter,
    messages,
    system,
    signal,
}: FinalizeRoundOptions): Promise<Round> {
    const content = await ensureDisplayContent({
        content: getRoundContent(round),
        adapter,
        messages,
        system,
        signal,
    });
    return withContent(round, content);
}

function getRoundContent(round: Round): string {
    return round.actions
        .filter(action => action.type === 'content' && action.content.length > 0)
        .map(action => action.content)
        .join('');
}

function withContent(round: Round, content: string): Round {
    const actions = round.actions.filter(action => action.type !== 'content');
    if (content.length > 0) actions.push(new Action({ type: 'content', content }));
    round.replaceActions(actions);
    return round;
}

async function ensureDisplayContent({
    content,
    adapter,
    messages,
    system,
    signal,
}: FinalizeRoundOptions & { content: string }): Promise<string> {
    if (content.trim().length > 0) return content;
    logger('agent.loop.emptyResponseFallback.start');
    try {
        const response = await adapter.chat(
            [
                ...messages,
                adapter.createUserMsg(EMPTY_RESPONSE_FALLBACK_PROMPT),
            ],
            [],
            system,
            signal ?? undefined
        );
        const fallbackContent = getActionsContent(response.actions);
        logger('agent.loop.emptyResponseFallback.end', {
            hasContent: fallbackContent.trim().length > 0,
            status: response.status,
        });
        return fallbackContent;
    } catch (error) {
        logger('agent.loop.emptyResponseFallback.error', { error: errorMessage(error) });
        return '我这次没有整理出可用回答。请补充一下你想确认的具体场景或目标。';
    }
}

function getActionsContent(actions: Action[]): string {
    return actions
        .filter(action => action.type === 'content' && action.content.length > 0)
        .map(action => action.content)
        .join('');
}
