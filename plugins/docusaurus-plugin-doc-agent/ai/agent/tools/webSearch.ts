import { defineTool } from './toolRegistry';
import type { RuntimeTool, ToolEvent, ToolInput, ToolResult, UnknownRecord } from '../types';

/**
 * Web Search Tool - 联网搜索能力。
 *
 * 两种实现模式由开发者选择：
 * 1. proxy 模式（默认）：浏览器调用后端搜索代理接口。
 * 2. model 模式：返回搜索请求 prompt，由模型自身能力处理。
 */

interface FormatResults {
    (data: unknown, query: string): string;
}

interface WebSearchToolOptions {
    endpoint?: string;
    formatResults?: FormatResults;
    maxResults?: number;
    mode?: string;
    modelPrompt?: string;
}

interface ProxyOptions {
    endpoint: string;
    formatResults?: FormatResults;
    maxResults: number;
}

interface ModelOptions {
    maxResults: number;
    modelPrompt?: string;
}

interface WebSearchInput extends ToolInput {
    query?: string;
}

interface WebSearchEvent extends ToolEvent {
    mode: 'proxy' | 'model';
    query: string;
    resultCount?: number;
    type: 'web_search';
}

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * @param options - Web search options.
 */
export function createWebSearchTool({
    mode = 'proxy',
    endpoint = '/agent/v1/search',
    formatResults,
    modelPrompt,
    maxResults = 5,
}: WebSearchToolOptions = {}): RuntimeTool {
    return defineTool({
        name: 'web_search',
        description: 'Search the internet for real-time information. Use when the question requires up-to-date information not available in local documents.',
        input_schema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query keywords',
                },
            },
            required: ['query'],
        },
        execute: mode === 'proxy'
            ? async (input) => executeProxy(input, { endpoint, formatResults, maxResults })
            : async (input) => executeModel(input, { modelPrompt, maxResults }),
    });
}

// ======================== Proxy 模式 ========================

async function executeProxy({ query }: WebSearchInput, { endpoint, formatResults: customFormat, maxResults }: ProxyOptions): Promise<ToolResult<string, WebSearchEvent>> {
    const q = typeof query === 'string' ? query : '';
    if (!q) return { result: '请提供搜索关键词' };

    const url = `${endpoint}?q=${encodeURIComponent(q)}&limit=${maxResults}`;

    let data: unknown;
    try {
        const res = await fetch(url);
        if (!res.ok) {
            const text = await res.text();
            return { result: `[Search Error] ${res.status}: ${text.slice(0, 200)}` };
        }
        data = await res.json();
    } catch (e) {
        return { result: `[Search Error] ${errorMessage(e)}` };
    }

    const formatted = customFormat
        ? customFormat(data, q)
        : defaultFormatResults(data, q);
    const record = isRecord(data) ? data : {};
    const resultCount = Array.isArray(data)
        ? data.length
        : Array.isArray(record.results)
            ? record.results.length
            : 0;

    return {
        result: formatted,
        event: { type: 'web_search', query: q, mode: 'proxy', resultCount },
    };
}

// ======================== Model 模式 ========================

async function executeModel({ query }: WebSearchInput, { modelPrompt, maxResults }: ModelOptions): Promise<ToolResult<string, WebSearchEvent>> {
    const q = typeof query === 'string' ? query : '';
    if (!q) return { result: '请提供搜索关键词' };

    // model 模式不在 tool 内真正调用模型，而是返回 prompt 交给上层对话处理。
    const prompt = modelPrompt
        ? modelPrompt.replace('{{query}}', q).replace('{{maxResults}}', String(maxResults))
        : `Please search the web for: "${q}" and provide the top ${maxResults} results with titles, URLs, and brief summaries.`;

    return {
        result: `[Web Search Request]\n${prompt}\n\nNote: This search request will be handled by the model's built-in capabilities. If the model cannot access the web, this tool call will return no results.`,
        event: { type: 'web_search', query: q, mode: 'model' },
    };
}

// ======================== 默认格式 ========================

function defaultFormatResults(data: unknown, query: string): string {
    const record = isRecord(data) ? data : {};
    const results = Array.isArray(data)
        ? data
        : Array.isArray(record.results)
            ? record.results
            : Array.isArray(record.items)
                ? record.items
                : [];

    if (results.length === 0) {
        return `No results found for "${query}".`;
    }

    const formatted = results.map((value, i) => {
        const r = isRecord(value) ? value : {};
        const title = typeof r.title === 'string' ? r.title : typeof r.name === 'string' ? r.name : '';
        const url = typeof r.url === 'string' ? r.url : typeof r.link === 'string' ? r.link : '';
        const snippet = typeof r.snippet === 'string'
            ? r.snippet
            : typeof r.description === 'string'
                ? r.description
                : typeof r.content === 'string'
                    ? r.content
                    : '';
        return `${i + 1}. ${title}\n   ${url}\n   ${snippet}`;
    }).join('\n\n');

    return `Search results for "${query}":\n\n${formatted}`;
}
