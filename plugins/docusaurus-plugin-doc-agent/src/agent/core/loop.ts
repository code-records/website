import type { AgentEvent } from '../Agent';
import type { Agent } from '../Agent';
import type { Model, ModelEvent, ModelMessage, ToolCall } from '../model/Model';
import type { AskModel, Tool } from '../tools/Tool';
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

    const context = new Context(options.context);
    const runtimeTools = subAgents.length > 0
        ? [...tools, new SubAgentTool({ subAgents })]
        : tools;
    const toolRegistry = new ToolRegistry(runtimeTools);
    const createAsk = createAskFactory({ model, signal, system });

    for (let round = 0; round < maxRounds && !signal?.aborted; round++) {
        const toolCalls: ToolCall[] = [];
        let status: 'tool' | 'continue' | 'final' = 'final';
        let raw: ModelMessage | undefined;

        for await (const event of model.stream({
            system,
            messages: context.toModelMessages(),
            tools: toolRegistry.definitions(),
            signal,
        })) {
            yield toAgentModelEvent(agentName, event);

            if (event.type === 'tool_call_done') {
                toolCalls.push(event.call);
            }

            if (event.type === 'done') {
                status = event.response.status;
                raw = event.response.raw;
                if (toolCalls.length === 0) {
                    toolCalls.push(...event.response.toolCalls);
                }
            }

            if (event.type === 'error') {
                throw event.error;
            }
        }

        if (status === 'final') {
            return;
        }

        if (status === 'continue') {
            if (raw !== undefined) {
                context.append([raw]);
            }
            continue;
        }

        if (status === 'tool') {
            if (raw !== undefined) {
                context.append([raw]);
            }
            if (toolCalls.length === 0) {
                throw new Error('Model returned tool status without tool calls');
            }

            for (const call of toolCalls) {
                const tool = toolRegistry.require(call.name);
                tool.setAsk(createAsk(call.name));

                yield {
                    type: 'tool_start',
                    agent: agentName,
                    callId: call.id,
                    tool: call.name,
                };

                const result = await executeToolCall(call, {
                    context: context.snapshot(),
                    createAsk,
                    model,
                    registry: toolRegistry,
                    signal,
                    timeoutMs: toolTimeoutMs,
                });

                yield {
                    type: 'tool_done',
                    agent: agentName,
                    callId: call.id,
                    result,
                    tool: call.name,
                };

                for (const event of result.events ?? []) {
                    yield {
                        type: 'tool_event',
                        agent: agentName,
                        event,
                        tool: call.name,
                    };
                }

                if (result.contextPatch !== undefined) {
                    context.apply(result.contextPatch);
                    yield {
                        type: 'context_patch',
                        agent: agentName,
                        patch: result.contextPatch,
                        tool: call.name,
                    };
                }

                context.append([
                    model.createToolResultMsg(call.id, result.result),
                ]);
            }

            continue;
        }

        throw new Error(`Unsupported model response status: ${status}`);
    }

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
    return {
        type: 'model_event',
        agent: agentName,
        event,
    };
}
