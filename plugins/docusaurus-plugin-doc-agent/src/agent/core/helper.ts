import type { AgentEvent } from '../Agent';
import type { Message } from '../chat/Message';
import type { Model, ModelAction, ModelEvent } from '../model/Model';
import type { AskModel, ContextPatch, ToolResult } from '../tools/Tool';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ToolError } from '../utils/errors';
import type { ToolCall } from './ToolCall';
import { ToolRunner } from './ToolRunner';

export interface ExecuteToolCallOptions {
    context: readonly Message[];
    createAsk?: (toolName: string) => AskModel;
    model: Model;
    registry: ToolRegistry;
    signal?: AbortSignal;
    timeoutMs?: number;
}

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

export function applyContextPatch(messages: readonly Message[], patch: ContextPatch): Message[] {
    if (patch.type === 'append') {
        return [...messages, ...patch.context];
    }
    if (patch.type === 'replace' || patch.type === 'compact') {
        return [...patch.context];
    }
    return [...messages];
}

export function toAgentModelEvent(agentName: string, event: ModelEvent): AgentEvent {
    return {
        type: 'model_event',
        agent: agentName,
        event,
    };
}

export function mergeAction(actions: ModelAction[], action: ModelAction): void {
    if (action.type === 'tool') {
        const index = actions.findIndex(item => item.type === 'tool' && item.call.id === action.call.id);
        if (index >= 0) {
            actions[index] = action;
            return;
        }
    }

    actions.push(action);
}

export async function executeToolCall(
    call: ToolCall,
    options: ExecuteToolCallOptions,
): Promise<ToolResult> {
    const runner = new ToolRunner({
        context: options.context,
        createAsk: options.createAsk,
        defaultTimeoutMs: options.timeoutMs,
        model: options.model,
        registry: options.registry,
        signal: options.signal,
    });

    const result = await runner.runCall(call, options.timeoutMs);
    if (result === undefined) {
        throw new ToolError(call.name, `Tool ${call.name} did not return a result`);
    }
    return result;
}
