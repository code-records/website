import { Message } from '../chat/Message';
import type { Model } from '../model/Model';
import type { ToolCall } from '../core/ToolCall';
import { ToolError, toError } from '../utils/errors';
import type { AskModel, JsonObject, ToolResult } from './Tool';
import { ToolRegistry } from './ToolRegistry';

export type ToolRunMode = 'parallel' | 'serial';
export type ToolTimeoutAction = 'continue' | 'kill';

export interface ToolRunPlanItem {
    input: JsonObject;
    name: string;
    timeoutMs?: number;
}

export interface ToolRunPlan {
    items: ToolRunPlanItem[];
    mode: ToolRunMode;
    timeoutAction?: ToolTimeoutAction;
}

export interface ToolRunRecord {
    error?: string;
    input: JsonObject;
    name: string;
    result?: ToolResult;
    runId: string;
    status: 'done' | 'error' | 'killed' | 'skipped' | 'timeout';
}

export interface ToolRunnerOptions {
    createAsk?: (toolName: string) => AskModel;
    context: readonly Message[];
    defaultTimeoutMs?: number;
    model: Model;
    registry: ToolRegistry;
    signal?: AbortSignal;
}

export class ToolRunner {
    private readonly controllers = new Map<string, AbortController>();
    private readonly context: readonly Message[];
    private readonly createAsk?: (toolName: string) => AskModel;
    private readonly defaultTimeoutMs: number;
    private readonly model: Model;
    private readonly registry: ToolRegistry;
    private readonly signal?: AbortSignal;

    constructor({
        context,
        createAsk,
        defaultTimeoutMs = 30000,
        model,
        registry,
        signal,
    }: ToolRunnerOptions) {
        this.context = context;
        this.createAsk = createAsk;
        this.defaultTimeoutMs = defaultTimeoutMs;
        this.model = model;
        this.registry = registry;
        this.signal = signal;
    }

    async runCall(call: ToolCall, timeoutMs = this.defaultTimeoutMs): Promise<ToolResult> {
        const record = await this.runItem({
            input: call.input,
            name: call.name,
            timeoutMs,
        }, call.id);

        if (record.result !== undefined) {
            return record.result;
        }

        throw new ToolError(call.name, `Tool ${call.name} failed with status ${record.status}`);
    }

    async runPlan(plan: ToolRunPlan): Promise<ToolRunRecord[]> {
        const timeoutAction = plan.timeoutAction ?? 'kill';

        if (plan.mode === 'serial') {
            const records: ToolRunRecord[] = [];
            for (let index = 0; index < plan.items.length; index++) {
                const record = await this.runItem(plan.items[index]);
                records.push(record);
                if (timeoutAction === 'kill' && (record.status === 'timeout' || record.status === 'killed')) {
                    for (const skipped of plan.items.slice(index + 1)) {
                        records.push(this.createSkippedRecord(skipped, 'Skipped because an earlier scheduled tool was killed.'));
                    }
                    break;
                }
            }
            return records;
        }

        return Promise.all(plan.items.map(async (item) => {
            const record = await this.runItem(item);
            if (timeoutAction === 'kill' && (record.status === 'timeout' || record.status === 'killed')) {
                this.killAll();
            }
            return record;
        }));
    }

    kill(runId: string): boolean {
        const controller = this.controllers.get(runId);
        if (controller === undefined) {
            return false;
        }
        controller.abort();
        this.controllers.delete(runId);
        return true;
    }

    private async runItem(item: ToolRunPlanItem, runId = createRunId(item.name)): Promise<ToolRunRecord> {
        const controller = new AbortController();
        const timeoutMs = item.timeoutMs ?? this.defaultTimeoutMs;
        this.controllers.set(runId, controller);

        const abortFromParent = () => controller.abort();
        this.signal?.addEventListener('abort', abortFromParent, { once: true });

        try {
            const tool = this.registry.require(item.name);
            if (this.createAsk !== undefined) {
                tool.setAsk(this.createAsk(item.name));
            }

            const run = tool.run(item.input, {
                context: this.context,
                createUserContextMessage: Message.user,
                runner: this,
                signal: controller.signal,
                tools: this.registry.asReadonlyMap(),
            });

            const result = timeoutMs > 0
                ? await withTimeout(run, timeoutMs, item.name, controller)
                : await run;

            return {
                input: item.input,
                name: item.name,
                result,
                runId,
                status: 'done',
            };
        } catch (error) {
            const err = toError(error);
            const errorMessage = err.message;
            if (err.name === 'AbortError') {
                return {
                    error: errorMessage,
                    input: item.input,
                    name: item.name,
                    runId,
                    status: 'killed',
                };
            }
            if (err instanceof ToolTimeoutError) {
                return {
                    error: errorMessage,
                    input: item.input,
                    name: item.name,
                    runId,
                    status: 'timeout',
                };
            }
            return {
                error: errorMessage,
                input: item.input,
                name: item.name,
                runId,
                status: 'error',
            };
        } finally {
            this.signal?.removeEventListener('abort', abortFromParent);
            this.controllers.delete(runId);
        }
    }

    private killAll(): void {
        for (const runId of Array.from(this.controllers.keys())) {
            this.kill(runId);
        }
    }

    private createSkippedRecord(item: ToolRunPlanItem, error: string): ToolRunRecord {
        return {
            error,
            input: item.input,
            name: item.name,
            runId: createRunId(item.name),
            status: 'skipped',
        };
    }
}

function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    toolName: string,
    controller: AbortController,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new ToolTimeoutError(`Tool "${toolName}" timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    });
}

function createRunId(toolName: string): string {
    return `${toolName}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

class ToolTimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ToolTimeoutError';
    }
}
