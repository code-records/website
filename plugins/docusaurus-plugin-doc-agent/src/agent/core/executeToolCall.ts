import type { Model, ModelMessage, ToolCall } from '../model/Model';
import type { AskModel, ToolResult } from '../tools/Tool';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ToolError } from '../utils/errors';
import { ToolRunner } from './ToolRunner';

export interface ExecuteToolCallOptions {
    context: readonly ModelMessage[];
    createAsk?: (toolName: string) => AskModel;
    model: Model;
    registry: ToolRegistry;
    signal?: AbortSignal;
    timeoutMs?: number;
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
