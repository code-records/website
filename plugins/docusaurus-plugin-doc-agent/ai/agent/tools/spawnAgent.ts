import { defineTool } from './toolRegistry';
import type { RuntimeTool, ToolEvent, ToolInput, UnknownRecord } from '../types';

/**
 * Built-in sub-agent tool.
 *
 * The caller supplies createSubAgent; this tool forwards a task to that agent and
 * returns its final non-thinking text.
 */

interface SubAgentEvent {
    content?: string;
    data?: unknown;
    phase?: string;
    type?: string;
}

interface SpawnAgentInput extends ToolInput {
    context?: string;
    task?: string;
}

interface SpawnAgentEvent extends ToolEvent {
    task: string;
    type: 'sub_agent_done' | 'sub_agent_error';
}

interface SubAgentEventStream extends AsyncIterable<SubAgentEvent> {
}

interface SubAgentLike {
    send(input: { question: string }): SubAgentEventStream;
}

interface CreateSubAgent {
    (): SubAgentLike;
}

interface SpawnAgentToolOptions {
    createSubAgent?: CreateSubAgent;
    maxTokens?: number;
}

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function createSpawnAgentTool({ createSubAgent, maxTokens = 2048 }: SpawnAgentToolOptions = {}): RuntimeTool {
    return defineTool({
        name: 'spawn_agent',
        description: 'Spawn a sub-agent to handle a subtask independently. The sub-agent gets its own conversation context and returns a result. Use this when a task can be broken into independent subtasks.',
        input_schema: {
            type: 'object',
            properties: {
                task: {
                    type: 'string',
                    description: 'The task description for the sub-agent to complete',
                },
                context: {
                    type: 'string',
                    description: 'Optional context/background information for the sub-agent',
                },
            },
            required: ['task'],
        },
        async execute(input) {
            if (!createSubAgent) {
                return { result: '[Error] Sub-agent spawning is not configured.' };
            }

            const subAgent = createSubAgent();
            const task = typeof input.task === 'string' ? input.task : '';
            const context = typeof input.context === 'string' ? input.context : '';
            const question = context
                ? `Context: ${context}\n\nTask: ${task}`
                : task;

            let finalContent = '';
            try {
                for await (const event of subAgent.send({ question })) {
                    if (event.type === 'text_delta' && event.phase !== 'thinking') {
                        finalContent += event.content;
                    }
                    if (event.type === 'error') {
                        const data = isRecord(event.data) ? event.data : {};
                        const message = typeof data.message === 'string' ? data.message : 'Unknown error';
                        return {
                            result: `[Sub-agent error] ${message}`,
                            event: { type: 'sub_agent_error', task },
                        };
                    }
                }
            } catch (e) {
                return {
                    result: `[Sub-agent error] ${errorMessage(e)}`,
                    event: { type: 'sub_agent_error', task },
                };
            }

            const truncated = finalContent.length > maxTokens * 4
                ? finalContent.slice(0, maxTokens * 4) + '\n\n[Response truncated]'
                : finalContent;

            return {
                result: truncated || '[Sub-agent returned no content]',
                event: { type: 'sub_agent_done', task },
            };
        },
    });
}
