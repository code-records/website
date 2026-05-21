export type AgentErrorCode =
    | 'ABORTED'
    | 'AGENT_ERROR'
    | 'CONTEXT_ERROR'
    | 'MODEL_ERROR'
    | 'TOOL_ERROR'
    | 'TRACE_ERROR';

export interface AgentErrorOptions {
    cause?: Error;
}

export class AgentError extends Error {
    readonly code: AgentErrorCode;
    override readonly cause?: Error;

    constructor(code: AgentErrorCode, message: string, options: AgentErrorOptions = {}) {
        super(message);
        this.name = 'AgentError';
        this.code = code;
        this.cause = options.cause;
    }
}

export class ModelError extends AgentError {
    constructor(message: string, options: AgentErrorOptions = {}) {
        super('MODEL_ERROR', message, options);
        this.name = 'ModelError';
    }
}

export class ToolError extends AgentError {
    readonly tool: string;

    constructor(tool: string, message: string, options: AgentErrorOptions = {}) {
        super('TOOL_ERROR', message, options);
        this.name = 'ToolError';
        this.tool = tool;
    }
}

export class ContextError extends AgentError {
    constructor(message: string, options: AgentErrorOptions = {}) {
        super('CONTEXT_ERROR', message, options);
        this.name = 'ContextError';
    }
}

export class TraceError extends AgentError {
    constructor(message: string, options: AgentErrorOptions = {}) {
        super('TRACE_ERROR', message, options);
        this.name = 'TraceError';
    }
}

export function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
