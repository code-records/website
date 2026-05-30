import type { Context } from '../../core/Context';
import type { Agent } from '../../core/Agent';
import type { Model, ModelToolCall } from '../../model/Model';
import { ToolError } from '../../utils/errors';
import type { AskModel, Tool, ToolUsage, ToolDefinition, ToolResult } from './Tool';
import { SubAgentTool } from '../SubAgentTool';
import { ToolRegistry } from './ToolRegistry';
import { ToolRunner, type CompletedToolRunRecord } from './ToolRunner';

export interface ToolManagerOptions {
    context: Context;
    createAsk?: (toolName: string) => AskModel;
    defaultTimeoutMs?: number;
    model: Model;
    signal?: AbortSignal;
    subAgents?: readonly Agent[];
    tools: readonly Tool[];
}

export class ToolManager {
    private readonly createAsk?: (toolName: string) => AskModel;
    private readonly defaultTimeoutMs?: number;
    private readonly model: Model;
    private readonly registry: ToolRegistry;
    private readonly signal?: AbortSignal;

    constructor({
        context,
        createAsk,
        defaultTimeoutMs,
        model,
        signal,
        subAgents = [],
        tools,
    }: ToolManagerOptions) {
        this.createAsk = createAsk;
        this.defaultTimeoutMs = defaultTimeoutMs;
        this.model = model;
        const runtimeTools = subAgents.length > 0
            ? [...tools, new SubAgentTool({ subAgents })]
            : tools;
        this.registry = new ToolRegistry(runtimeTools);
        this.signal = signal;
        this.context = context;
    }

    private context: Context;

    definitions(): ToolDefinition[] {
        return this.registry.definitions();
    }

    require(name: string): Tool {
        return this.registry.require(name);
    }

    formatLabel(call: ModelToolCall): string {
        const tool = this.registry.require(call.name);
        return tool.formatLabel(call.input, {
            call,
            input: call.input,
        });
    }

    formatUsage(call: ModelToolCall): ToolUsage {
        const tool = this.registry.require(call.name);
        return tool.formatUsage(call.input, {
            call,
            input: call.input,
        });
    }

    setContext(context: Context): void {
        this.context = context;
    }

    async runCall(call: ModelToolCall, timeoutMs?: number): Promise<ToolResult>;
    async runCall(call: ModelToolCall, timeoutMs?: number): Promise<ToolResult> {
        return (await this.runCallRecord(call, timeoutMs)).result;
    }

    async runCallRecord(call: ModelToolCall, timeoutMs?: number): Promise<CompletedToolRunRecord>;
    async runCallRecord(call: ModelToolCall, timeoutMs?: number): Promise<CompletedToolRunRecord> {
        const resolvedTimeoutMs = timeoutMs ?? this.defaultTimeoutMs;
        const runner = new ToolRunner({
            context: this.context,
            createAsk: this.createAsk,
            defaultTimeoutMs: resolvedTimeoutMs,
            model: this.model,
            registry: this.registry,
            signal: this.signal,
        });

        const record = await runner.runCallRecord(call, resolvedTimeoutMs);
        if (record.result === undefined) {
            throw new ToolError(call.name, `Tool ${call.name} did not return a result`);
        }
        return record;
    }
}
