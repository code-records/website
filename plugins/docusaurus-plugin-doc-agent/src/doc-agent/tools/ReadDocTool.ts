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

function resolveDocFilePathCandidates(url: string): string[] {
    const normalized = url?.replace(/\/+$/, '').replace(/^\//, '') || '';
    if (!normalized) return [];
    if (/\.(md|mdx)$/i.test(normalized)) return [normalized];
    return [`${normalized}.md`, `${normalized}.mdx`];
}

async function readDocFile(filePath: string): Promise<string | null> {
    if (!readonlyClient) {
        throw new Error('Readonly client is not initialized.');
    }
    return readonlyClient.readFileReadonly(filePath);
}

export async function readDocByUrl(url: string) {
    const filePaths = resolveDocFilePathCandidates(url);
    if (filePaths.length === 0) return { filePath: null, content: null };

    for (const filePath of filePaths) {
        const content = await readDocFile(filePath);
        if (content) return { filePath, content };
    }

    return { filePath: filePaths[0], content: null };
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

        let filePaths: string[];
        try {
            filePaths = resolveDocFilePathCandidates(url);
        } catch (error) {
            const message = errorMessage(error);
            logger('tool.read_doc.error', { url, error: message });
            return {
                result: `读取文档失败: ${url}\n\n${message}`,
                events: [{ type: 'read_doc', data: { status: 'error', url, error: message } }],
            };
        }

        if (filePaths.length === 0) {
            logger('tool.read_doc.not_found', { url });
            return {
                result: `未找到文档: ${url}`,
                events: [{ type: 'read_doc', data: { status: 'not_found', url } }],
            };
        }

        logger('tool.read_doc.start', { url, filePaths });

        let content: string | null;
        let filePath: string | null = null;
        try {
            content = null;
            for (const candidate of filePaths) {
                const candidateContent = await readDocFile(candidate);
                if (candidateContent) {
                    filePath = candidate;
                    content = candidateContent;
                    break;
                }
            }
        } catch (error) {
            const message = errorMessage(error);
            logger('tool.read_doc.error', { url, filePaths, error: message });
            return {
                result: `读取文档失败: ${url}\n\n${message}`,
                events: [{ type: 'read_doc', data: { status: 'error', url, error: message } }],
            };
        }

        if (!content) {
            logger('tool.read_doc.not_found', { url, filePaths });
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
