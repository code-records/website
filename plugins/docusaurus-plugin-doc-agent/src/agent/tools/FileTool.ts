import {
    Tool,
    type JsonObject,
    type ToolDisplay,
    type ToolDisplayContext,
    type ToolDisplayPhase,
    type ToolInput,
    type ToolPromptSchema,
    type ToolResult,
    type ToolRunContext,
} from './tool/Tool';

export type FileToolOperation =
    | 'delete'
    | 'exists'
    | 'list'
    | 'read'
    | 'stat'
    | 'write';

export interface FileToolInput {
    content?: string;
    operation: FileToolOperation;
    path: string;
}

export interface FileToolOutput {
    content?: string;
    exists?: boolean;
    operation: FileToolOperation;
    path: string;
    size?: number;
}

export abstract class FileTool extends Tool {
    name = 'file';
    description = 'Access files through a concrete agent-provided filesystem implementation.';
    prompt: ToolPromptSchema = {
        properties: {
            content: {
                description: 'Content to write when operation is write',
                type: 'string',
            },
            operation: {
                description: 'File operation',
                enum: ['delete', 'exists', 'list', 'read', 'stat', 'write'],
                type: 'string',
            },
            path: {
                description: 'Workspace-relative file path',
                type: 'string',
            },
        },
        required: ['operation', 'path'],
        type: 'object',
    };

    createDisplay(input: ToolInput, context: ToolDisplayContext = { input, phase: 'start' }): ToolDisplay {
        const parsed = parseFileToolInput(input);
        return {
            title: fileOperationTitle(parsed.operation),
            subtitle: parsed.path,
            statusText: fileOperationStatusText(parsed.operation, context.phase),
            variant: context.phase === 'error' ? 'danger' : context.phase === 'done' ? 'success' : 'default',
        };
    }

    updateDisplay(display: ToolDisplay, phase: ToolDisplayPhase, context: ToolDisplayContext): ToolDisplay {
        const parsed = parseFileToolInput(context.input);
        display.title = fileOperationTitle(parsed.operation);
        display.subtitle = parsed.path;
        display.statusText = fileOperationStatusText(parsed.operation, phase);
        display.variant = phase === 'error' ? 'danger' : phase === 'done' ? 'success' : 'default';
        return display;
    }

    protected async execute(input: ToolInput, context: ToolRunContext): Promise<ToolResult> {
        const parsed = parseFileToolInput(input);
        await this.checkAbort(context.signal);
        await this.checkPause();

        const output = await this.executeFileOperation(parsed, context);

        return {
            events: [{
                data: fileToolOutputToJson(output),
                type: 'file_operation',
            }],
            result: formatFileToolOutput(output),
        };
    }

    protected abstract executeFileOperation(input: FileToolInput, context: ToolRunContext): Promise<FileToolOutput>;

    protected async checkAbort(signal?: AbortSignal): Promise<void> {
        if (signal?.aborted) {
            throw new DOMException('File tool aborted', 'AbortError');
        }
    }
}

function fileOperationTitle(operation: FileToolOperation): string {
    switch (operation) {
        case 'delete':
            return 'Delete file';
        case 'exists':
            return 'Check file';
        case 'list':
            return 'List files';
        case 'read':
            return 'Read input';
        case 'stat':
            return 'Inspect file';
        case 'write':
            return 'Write file';
    }
}

function fileOperationStatusText(operation: FileToolOperation, phase: ToolDisplayPhase): string {
    if (phase === 'error') {
        return fileOperationVerb(operation, 'failed');
    }
    if (phase === 'done') {
        return fileOperationVerb(operation, 'done');
    }
    return fileOperationVerb(operation, 'running');
}

function fileOperationVerb(operation: FileToolOperation, state: 'done' | 'failed' | 'running'): string {
    const text = {
        delete: { done: '删除完成', failed: '删除失败', running: '删除中' },
        exists: { done: '检查完成', failed: '检查失败', running: '检查中' },
        list: { done: '读取完成', failed: '读取失败', running: '读取中' },
        read: { done: '读取完成', failed: '读取失败', running: '读取中' },
        stat: { done: '检查完成', failed: '检查失败', running: '检查中' },
        write: { done: '写入完成', failed: '写入失败', running: '写入中' },
    } satisfies Record<FileToolOperation, Record<typeof state, string>>;

    return text[operation][state];
}

function parseFileToolInput(input: ToolInput): FileToolInput {
    const operation = isFileToolOperation(input.operation) ? input.operation : 'read';
    const path = typeof input.path === 'string' ? input.path : '';
    const content = typeof input.content === 'string' ? input.content : undefined;
    return {
        ...(content !== undefined ? { content } : {}),
        operation,
        path,
    };
}

function isFileToolOperation(value: unknown): value is FileToolOperation {
    return value === 'delete'
        || value === 'exists'
        || value === 'list'
        || value === 'read'
        || value === 'stat'
        || value === 'write';
}

function formatFileToolOutput(output: FileToolOutput): string {
    if (output.content !== undefined) {
        return output.content;
    }

    const details = Object.entries(output)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join('\n');
    return details.length > 0 ? details : `${output.operation} completed: ${output.path}`;
}

function fileToolOutputToJson(output: FileToolOutput): JsonObject {
    return {
        ...(output.content !== undefined ? { content: output.content } : {}),
        ...(output.exists !== undefined ? { exists: output.exists } : {}),
        operation: output.operation,
        path: output.path,
        ...(output.size !== undefined ? { size: output.size } : {}),
    };
}
