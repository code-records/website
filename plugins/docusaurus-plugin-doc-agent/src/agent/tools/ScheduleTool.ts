import type {
    ToolRunMode,
    ToolRunPlan,
    ToolRunPlanItem,
    ToolRunRecord,
    ToolTimeoutAction,
} from './tool/ToolRunner';
import { Tool, type JsonObject, type JsonValue, type ToolInput, type ToolInputSchema, type ToolResult, type ToolRunContext } from './tool/Tool';

export interface ScheduleToolOptions {
    maxItems?: number;
}

interface ScheduleInput {
    items: ToolRunPlanItem[];
    mode: ToolRunMode;
    reason: string;
    timeoutAction: ToolTimeoutAction;
}

export class ScheduleTool extends Tool {
    name = 'schedule_tools';
    description = [
        'Run multiple tools as one scheduled batch.',
        'Use this when several independent tool calls can run in parallel, or when a sequence must run serially with timeouts.',
    ].join(' ');

    input_schema: ToolInputSchema = {
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

    constructor({ maxItems = 8 }: ScheduleToolOptions = {}) {
        super();
        this.maxItems = maxItems;
    }

    protected async execute(input: ToolInput, context: ToolRunContext): Promise<ToolResult> {
        if (context.runner === undefined) {
            return {
                result: 'Scheduling failed: no tool runner is available in this execution context.',
            };
        }

        const parsed = this.parseInput(input, context);
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
        const summary = summarizeRecords(records);

        return {
            events: [{
                data: {
                    count: records.length,
                    mode: parsed.mode,
                    reason: parsed.reason,
                    records: records.map(recordToEventData),
                    timeoutAction: parsed.timeoutAction,
                },
                type: 'tools_scheduled',
            }],
            result: [
                `Scheduled ${records.length} tool call(s) in ${parsed.mode} mode.`,
                `Timeout action: ${parsed.timeoutAction}.`,
                summary,
            ].filter(Boolean).join('\n'),
        };
    }

    private parseInput(input: ToolInput, context: ToolRunContext): ScheduleInput {
        const mode = input.mode === 'parallel' ? 'parallel' : 'serial';
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

function summarizeRecords(records: readonly ToolRunRecord[]): string {
    return records
        .map(record => {
            const suffix = record.error !== undefined ? `: ${record.error}` : '';
            return `- ${record.name} [${record.status}]${suffix}`;
        })
        .join('\n');
}

function recordToEventData(record: ToolRunRecord): JsonObject {
    return {
        error: record.error ?? null,
        name: record.name,
        result: record.result?.result ?? null,
        runId: record.runId,
        status: record.status,
    };
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
    return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}
