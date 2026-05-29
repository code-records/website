import {
    Tool,
    type JsonObject,
    type ToolUsage,
    type ToolInput,
    type ToolLabelContext,
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

    formatLabel(input: ToolInput, context: ToolLabelContext = { input }): string {
        const parsed = parseFileToolInput(input);
        if (parsed === null) return 'File operation';
        return `${fileOperationTitle(parsed.operation)}: ${parsed.path || '.'}`;
    }

    formatUsage(input: ToolInput, context: ToolLabelContext = { input }): ToolUsage {
        const parsed = parseFileToolInput(input);
        if (parsed === null) {
            return {
                count: 1,
                name: '文件操作',
                unit: '次',
                verb: '执行',
            };
        }
        return fileOperationUsage(parsed);
    }

    protected async execute(input: ToolInput, context: ToolRunContext): Promise<ToolResult> {
        const parsed = parseFileToolInput(input);
        if (parsed === null) {
            throw new Error(`Invalid file tool input: operation "${String(input.operation)}" is not recognized`);
        }
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

function fileOperationUsage(input: FileToolInput): ToolUsage {
    const key = input.path || '.';
    switch (input.operation) {
        case 'list':
            return {
                key,
                name: '文件夹',
                unit: '个',
                verb: '浏览',
            };
        case 'read':
            return {
                key,
                name: '文件',
                unit: '个',
                verb: '浏览',
            };
        case 'write':
            return {
                key,
                name: '文件',
                unit: '个',
                verb: '修改',
            };
        case 'delete':
            return {
                key,
                name: '文件',
                unit: '个',
                verb: '删除',
            };
        case 'exists':
        case 'stat':
            return {
                key,
                name: '文件',
                unit: '个',
                verb: '检查',
            };
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

function parseFileToolInput(input: ToolInput): FileToolInput | null {
    if (!isFileToolOperation(input.operation)) return null;
    const path = typeof input.path === 'string' ? input.path : '';
    const content = typeof input.content === 'string' ? input.content : undefined;
    return {
        ...(content !== undefined ? { content } : {}),
        operation: input.operation,
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
