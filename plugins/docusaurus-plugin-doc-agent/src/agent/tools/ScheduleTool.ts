import type {
    ToolRunMode,
    ToolRunPlan,
    ToolRunPlanItem,
    ToolRunRecord,
    ToolTimeoutAction,
} from './tool/ToolRunner';
import { mergeContextPatches } from './tool/contextPatch';
import {
    Tool,
    type ContextPatch,
    type JsonObject,
    type JsonValue,
    type ToolActivity,
    type ToolEvent,
    type ToolInput,
    type ToolPromptSchema,
    type ToolResult,
    type ToolRunContext,
} from './tool/Tool';

export interface ScheduleToolOptions {
    maxItems?: number;
    maxResultChars?: number;
}

interface ScheduleInput {
    items: ToolRunPlanItem[];
    mode: ToolRunMode;
    reason: string;
    timeoutAction: ToolTimeoutAction;
}

/**
 * Scheduling is modeled as a tool, not as a second loop.
 *
 * The outer loop still owns model turns and final context application. This tool
 * only groups lower-level tool calls into one intentional batch, so the model can
 * express "run these in parallel" or "do these in order" without making the core
 * loop understand every workflow shape.
 */
export class ScheduleTool extends Tool {
    name = 'schedule_tools';
    description = [
        'Run multiple tools as one scheduled batch.',
        'Use this when several independent tool calls can run in parallel, or when a sequence must run serially with timeouts.',
    ].join(' ');

    prompt: ToolPromptSchema = {
        properties: {
            items: {
                description: 'Tool calls to execute. Do not include schedule_tools itself.',
                items: {
                    properties: {
                        input: {
                            description: 'Input object for the target tool',
                            type: 'object',
                        },
                        name: {
                            description: 'Registered tool name',
                            type: 'string',
                        },
                        timeoutMs: {
                            description: 'Optional timeout for this tool call in milliseconds',
                            minimum: 0,
                            type: 'integer',
                        },
                    },
                    required: ['name', 'input'],
                    type: 'object',
                },
                type: 'array',
            },
            mode: {
                description: 'Run tools one after another, or at the same time',
                enum: ['serial', 'parallel'],
                type: 'string',
            },
            reason: {
                description: 'Why these tool calls should be scheduled together',
                type: 'string',
            },
            timeoutAction: {
                description: 'What to do when a scheduled tool times out',
                enum: ['kill', 'continue'],
                type: 'string',
            },
        },
        required: ['mode', 'items'],
        type: 'object',
    };

    private readonly maxItems: number;
    private readonly maxResultChars: number;

    constructor({ maxItems = 8, maxResultChars = 12000 }: ScheduleToolOptions = {}) {
        super();
        this.maxItems = maxItems;
        this.maxResultChars = maxResultChars;
    }

    formatActivity(input: ToolInput): ToolActivity {
        const rawItems = Array.isArray(input.items) ? input.items : [];
        return {
            count: Math.min(rawItems.length, this.maxItems),
            name: '工具',
            unit: '个',
            verb: '调度',
        };
    }

    protected async execute(input: ToolInput, context: ToolRunContext): Promise<ToolResult> {
        if (context.runner === undefined) {
            return {
                result: 'Scheduling failed: no tool runner is available in this execution context.',
            };
        }

        const parsed = this.parseInput(input, context);
        if (parsed === null) {
            return {
                result: `Scheduling failed: mode must be "serial" or "parallel". Got "${String(input.mode)}".`,
            };
        }
        if (parsed.items.length === 0) {
            return {
                result: 'Scheduling skipped: no valid tool calls were provided.',
            };
        }

        const plan: ToolRunPlan = {
            items: parsed.items,
            mode: parsed.mode,
            timeoutAction: parsed.timeoutAction,
        };
        const records = await context.runner.runPlan(plan);
        const contextPatches = records
            .map(record => record.result?.contextPatch)
            .filter((patch): patch is ContextPatch => patch !== undefined);
        const contextPatch = mergeContextPatches(context.context, contextPatches);
        const summary = summarizeRecords(records, this.maxResultChars);
        const events = createScheduleEvents(records, parsed);

        return {
            ...(contextPatch !== undefined ? { contextPatch } : {}),
            events,
            result: [
                `Scheduled ${records.length} tool call(s) in ${parsed.mode} mode.`,
                `Timeout action: ${parsed.timeoutAction}.`,
                summary,
            ].filter(Boolean).join('\n'),
        };
    }

    private parseInput(input: ToolInput, context: ToolRunContext): ScheduleInput | null {
        if (input.mode !== 'parallel' && input.mode !== 'serial') {
            return null;
        }
        const mode = input.mode;
        const timeoutAction = input.timeoutAction === 'continue' ? 'continue' : 'kill';
        const reason = typeof input.reason === 'string' ? input.reason : '';
        const rawItems = Array.isArray(input.items) ? input.items : [];
        const items: ToolRunPlanItem[] = [];

        for (const rawItem of rawItems.slice(0, this.maxItems)) {
            if (!isJsonObject(rawItem)) continue;

            const name = typeof rawItem.name === 'string' ? rawItem.name.trim() : '';
            if (name.length === 0 || name === this.name) continue;
            if (!context.tools.has(name)) continue;

            const itemInput = isJsonObject(rawItem.input) ? rawItem.input : {};
            const timeoutMs = typeof rawItem.timeoutMs === 'number' && Number.isFinite(rawItem.timeoutMs)
                ? Math.max(0, Math.floor(rawItem.timeoutMs))
                : undefined;

            items.push({
                input: itemInput,
                name,
                ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            });
        }

        return {
            items,
            mode,
            reason,
            timeoutAction,
        };
    }
}

export function createScheduleTool(options?: ScheduleToolOptions): ScheduleTool {
    return new ScheduleTool(options);
}

function summarizeRecords(records: readonly ToolRunRecord[], maxChars: number): string {
    let remaining = Math.max(0, maxChars);
    const lines: string[] = [];

    records.forEach((record, index) => {
        const title = `${index + 1}. ${record.name} [${record.status}]`;
        lines.push(record.error !== undefined ? `${title}: ${record.error}` : title);

        if (record.result?.result !== undefined && record.result.result.length > 0 && remaining > 0) {
            const output = truncateText(record.result.result, remaining);
            remaining -= output.length;
            lines.push(indentBlock(output));
        }

        if (record.result?.contextPatch !== undefined) {
            lines.push(`   contextPatch: ${record.result.contextPatch.type}`);
        }
    });

    return lines.join('\n');
}

function createScheduleEvents(records: readonly ToolRunRecord[], input: ScheduleInput): ToolEvent[] {
    return [
        {
            data: {
                count: records.length,
                mode: input.mode,
                reason: input.reason,
                records: records.map(recordToEventData),
                timeoutAction: input.timeoutAction,
            },
            type: 'tools_scheduled',
        },
        ...records.flatMap(record => (record.result?.events ?? []).map(event => ({
            data: {
                eventData: event.data ?? {},
                eventType: event.type,
                runId: record.runId,
                tool: record.name,
            },
            type: 'scheduled_tool_event',
        }))),
    ];
}

function recordToEventData(record: ToolRunRecord): JsonObject {
    return {
        contextPatch: record.result?.contextPatch?.type ?? null,
        error: record.error ?? null,
        name: record.name,
        result: record.result?.result ?? null,
        runId: record.runId,
        status: record.status,
    };
}

function truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
        return text;
    }
    return `${text.slice(0, Math.max(0, maxChars - 32))}\n[truncated scheduled tool output]`;
}

function indentBlock(text: string): string {
    return text
        .split('\n')
        .map(line => `   ${line}`)
        .join('\n');
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
    return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}
