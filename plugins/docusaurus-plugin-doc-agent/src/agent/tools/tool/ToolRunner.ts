import type { Context } from '../../core/Context';
import type { ModelToolCall } from '../../model/Model';
import { toError } from '../../utils/errors';
import type { AskModel, JsonObject, ToolResult } from './Tool';
import { ToolRegistry } from './ToolRegistry';
import { TOOL_ERROR_CORE_PROMPT } from '../../core/prompt';

interface ToolRunItem {
    input: JsonObject;
    name: string;
    timeoutMs?: number;
}

export interface ToolRunRecord {
    error?: string;
    input: JsonObject;
    name: string;
    result?: ToolResult;
    runId: string;
    status: 'done' | 'error' | 'killed' | 'timeout';
}

export interface CompletedToolRunRecord extends ToolRunRecord {
    result: ToolResult;
}

export interface ToolRunnerOptions {
    createAsk?: (toolName: string) => AskModel;
    context: Context;
    defaultTimeoutMs?: number;
    registry: ToolRegistry;
    signal?: AbortSignal;
}

export class ToolRunner {
    private readonly controllers = new Map<string, AbortController>();
    private context: Context;
    private readonly createAsk?: (toolName: string) => AskModel;
    private readonly defaultTimeoutMs: number;
    private readonly registry: ToolRegistry;
    private readonly signal?: AbortSignal;

    constructor({
        context,
        createAsk,
        defaultTimeoutMs = 30000,
        registry,
        signal,
    }: ToolRunnerOptions) {
        this.context = context;
        this.createAsk = createAsk;
        this.defaultTimeoutMs = defaultTimeoutMs;
        this.registry = registry;
        this.signal = signal;
    }

    async runCall(call: ModelToolCall, timeoutMs?: number): Promise<ToolResult>;
    async runCall(call: ModelToolCall, timeoutMs?: number): Promise<ToolResult> {
        return (await this.runCallRecord(call, timeoutMs)).result;
    }

    async runCallRecord(call: ModelToolCall, timeoutMs?: number): Promise<CompletedToolRunRecord>;
    async runCallRecord(call: ModelToolCall, timeoutMs?: number): Promise<CompletedToolRunRecord> {
        const resolvedTimeoutMs = timeoutMs ?? this.defaultTimeoutMs;
        const record = await this.runItem({
            input: call.input,
            name: call.name,
            timeoutMs: resolvedTimeoutMs,
        }, call.id);

        if (record.result !== undefined) {
            return {
                ...record,
                result: record.result,
            };
        }

        const details = record.error ? `: ${record.error}` : '';
        const errorMessage = `Tool ${call.name} failed with status ${record.status}${details}`;
        const formattedPrompt = TOOL_ERROR_CORE_PROMPT.replace('{{error}}', errorMessage);

        return {
            ...record,
            result: {
                result: formattedPrompt,
            },
        };
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

    private async runItem(item: ToolRunItem, runId = createRunId(item.name)): Promise<ToolRunRecord> {
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
