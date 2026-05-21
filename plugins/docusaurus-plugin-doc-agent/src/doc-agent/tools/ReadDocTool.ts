import { readonlyClient } from './api';
import { logger } from '../../agent/utils/logger';
import { Tool, type ToolInput, type ToolInputSchema, type ToolResult, type ToolRunContext } from '../../agent/tools';

const READ_DOC_MAX_CHARS = 8000;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getShortPath(url?: string) {
    return url?.replace(/^\/[^/]+\//, '') || '';
}

function resolveDocFilePath(url: string): string | null {
    const normalized = url?.replace(/\/+$/, '').replace(/^\//, '') || '';
    if (!normalized) return null;
    return `${normalized}.md`;
    // const normalizedUrl = url.replace(/\/+$/, '');
    // return urlMap[normalizedUrl]?.replace(/^\/+/, '') || null;
}

async function readDocFile(filePath: string): Promise<string | null> {
    if (!readonlyClient) {
        throw new Error('Readonly client is not initialized.');
    }
    return readonlyClient.readFileReadonly(filePath);
}

export async function readDocByUrl(url: string) {
    const filePath = resolveDocFilePath(url);
    if (!filePath) return { filePath: null, content: null };

    return {
        filePath,
        content: await readDocFile(filePath),
    };
}

class ReadDocTool extends Tool {
    name = 'read_doc';
    description = '读取指定文档的完整内容。传入 search_docs 返回的 URL 路径，获取文档的 Markdown 原文。需要读取多篇文档时，可以对多个 URL 分别发起 read_doc 调用，系统会并发执行。';
    input_schema: ToolInputSchema = {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: '文档 URL 路径，如 /{{docsRoot}}/platforms/pay-module/ke-hu-duan',
            },
        },
        required: ['url'],
    };

    protected async execute(input: ToolInput, _context: ToolRunContext): Promise<ToolResult> {
        const url = typeof input.url === 'string' ? input.url : '';
        if (!url) {
            return {
                result: '请提供文档 URL 路径',
                events: [{ type: 'read_doc', data: { status: 'error' } }],
            };
        }

        let filePath: string | null;
        try {
            filePath = resolveDocFilePath(url);
        } catch (error) {
            const message = errorMessage(error);
            logger('tool.read_doc.error', { url, error: message });
            return {
                result: `读取文档失败: ${url}\n\n${message}`,
                events: [{ type: 'read_doc', data: { status: 'error', url, error: message } }],
            };
        }

        if (!filePath) {
            logger('tool.read_doc.not_found', { url });
            return {
                result: `未找到文档: ${url}`,
                events: [{ type: 'read_doc', data: { status: 'not_found', url } }],
            };
        }

        logger('tool.read_doc.start', { url, filePath });

        let content: string | null;
        try {
            content = await readDocFile(filePath);
        } catch (error) {
            const message = errorMessage(error);
            logger('tool.read_doc.error', { url, filePath, error: message });
            return {
                result: `读取文档失败: ${url}\n\n${message}`,
                events: [{ type: 'read_doc', data: { status: 'error', url, error: message } }],
            };
        }

        if (!content) {
            logger('tool.read_doc.not_found', { url, filePath });
            return {
                result: `未找到文档: ${url}`,
                events: [{ type: 'read_doc', data: { status: 'not_found', url } }],
            };
        }

        const result = content.length <= READ_DOC_MAX_CHARS
            ? content
            : `${content.slice(0, READ_DOC_MAX_CHARS)}\n\n... (文档内容已截断，共 ${content.length} 字符)`;

        logger('tool.read_doc.end', {
            requestedUrl: url,
            filePath,
            contentLength: content.length,
            returnedLength: result.length,
        });

        return {
            result,
            events: [{ type: 'read_doc', data: { status: 'success', url, shortPath: getShortPath(url) } }],
        };
    }
}

export default new ReadDocTool();
