import { Action } from '../round/Action';
import { Round } from '../round/Round';
import type {
    AdapterChatResponse,
    AdapterMessageList,
    AgentLoopOptions,
    ToolDefinitionList,
} from '../types';

interface ContinueResponseOptions {
    adapter: AgentLoopOptions['adapter'];
    messages: AdapterMessageList;
    response: AdapterChatResponse;
    signal: AbortSignal | null;
    system: string;
    toolDefs: ToolDefinitionList;
}

interface ContinueResponseResult {
    response: AdapterChatResponse;
    round: Round;
}

export async function continueResponse({
    adapter,
    messages,
    response,
    signal,
    system,
    toolDefs,
}: ContinueResponseOptions): Promise<ContinueResponseResult> {
    let responseRound = Round.fromActions(response.actions);
    let content = getRoundContent(responseRound);

    while (response.status === 'continue') {
        messages.push(response.raw);
        messages.push(adapter.createUserMsg('继续'));
        response = await adapter.chat(messages, toolDefs, system, signal ?? undefined);
        responseRound = Round.fromActions(response.actions);
        content += getRoundContent(responseRound);
    }

    return {
        response,
        round: withContent(responseRound, content),
    };
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
    return Round.fromActions(actions);
}
