import type { Message } from '../../chat/Message';
import type { Agent } from '../../Agent';
import type { Model, ModelToolCall } from '../../model/Model';
import { ToolError } from '../../utils/errors';
import type { AskModel, Tool, ToolDefinition, ToolResult } from './Tool';
import { SubAgentTool } from '../SubAgentTool';
import { ToolRegistry } from './ToolRegistry';
import { ToolRunner } from './ToolRunner';

export interface ToolManagerOptions {
    context: readonly Message[];
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

    private context: readonly Message[];

    definitions(): ToolDefinition[] {
        return this.registry.definitions();
    }

    require(name: string): Tool {
        return this.registry.require(name);
    }

    setContext(context: readonly Message[]): void {
        this.context = context;
    }

    async runCall(call: ModelToolCall, timeoutMs = this.defaultTimeoutMs): Promise<ToolResult> {
        const runner = new ToolRunner({
            context: this.context,
            createAsk: this.createAsk,
            defaultTimeoutMs: timeoutMs,
            model: this.model,
            registry: this.registry,
            signal: this.signal,
        });

        const result = await runner.runCall(call, timeoutMs);
        if (result === undefined) {
            throw new ToolError(call.name, `Tool ${call.name} did not return a result`);
        }
        return result;
    }
}
