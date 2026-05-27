import { readonlyClient } from './api';
import { Tool, type ToolInput, type ToolInputSchema, type ToolResult, type ToolRunContext } from '../../../agent';

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

class BrowseTreeTool extends Tool {
    name = 'browse_tree';
    description = '浏览仓库目录结构。传入目录路径，返回该目录下的文件和子目录列表。';
    input_schema: ToolInputSchema = {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: '目录路径，如 "{{docsRoot}}/platforms"',
            },
            recursive: {
                type: 'boolean',
                description: '是否递归列出所有子目录内容，默认 false',
            },
        },
        required: ['path'],
    };

    protected async execute(input: ToolInput, _context: ToolRunContext): Promise<ToolResult> {
        const path = typeof input.path === 'string' ? input.path : '';
        const recursive = input.recursive === true;

        let paths: string[] | null;
        try {
            if (!readonlyClient) {
                throw new Error('Readonly client is not initialized.');
            }
            paths = await readonlyClient.readTreeReadonly(path, recursive);
        } catch (error) {
            const message = errorMessage(error);
            return {
                result: `浏览目录失败: ${path}\n\n${message}`,
                events: [{ type: 'browse_tree_error', data: { path, error: message } }],
            };
        }

        if (!paths || paths.length === 0) {
            return {
                result: `目录为空或不存在: ${path}`,
                events: [{ type: 'browse_tree', data: { path, count: 0 } }],
            };
        }

        return {
            result: `目录 ${path} 共 ${paths.length} 个条目：\n\n${paths.join('\n')}`,
            events: [{ type: 'browse_tree', data: { path, count: paths.length } }],
        };
    }
}

export default new BrowseTreeTool();
