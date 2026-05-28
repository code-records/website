import type { AgentEvent } from '../Agent';
import type { Model, ModelEvent } from '../model/Model';
import type { AskModel } from '../tools/tool/Tool';
export { applyContextPatch } from '../tools/tool/contextPatch';

export function createAskFactory({
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
            const response = await model.complete({
                system: `${system}\n\nCurrent tool: ${toolName}`,
                messages: [],
                toolAsk: request.prompt.build(request.input),
                toolChoice: 'none',
                signal,
            });
            return request.prompt.parse(response.content);
        };
    };
}

export function toAgentModelEvent(agentName: string, event: ModelEvent): AgentEvent {
    return {
        type: 'model_event',
        agent: agentName,
        event,
    };
}

