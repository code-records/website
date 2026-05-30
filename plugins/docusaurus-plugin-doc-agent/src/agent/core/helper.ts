import { AgentResult } from './AgentResult';
import { Context } from './Context';
import type { Model, ModelEvent } from '../model/Model';
import type { AskModel } from '../tools/tool/Tool';
import type { AgentEvent } from './type';
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
            const input = request.prompt.build(request.input);
            const response = await model.complete({
                context: Context.from(input),
                result: new AgentResult(),
                system: `${system}\n\nCurrent tool: ${toolName}`,
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

