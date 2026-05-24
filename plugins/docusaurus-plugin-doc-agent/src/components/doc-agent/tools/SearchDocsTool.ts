import { logger } from '../../../agent/utils/logger';
import { Tool, type JsonObject, type ToolInput, type ToolInputSchema, type ToolResult, type ToolRunContext } from '../../../agent/tools';

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const PAGEFIND_MODULE_URL: string = '/pagefind/pagefind.js';

interface PagefindModule {
    init(): Promise<void>;
    search(query: string): Promise<{ results: PagefindResult[] }>;
}

interface PagefindResult {
    data(): Promise<PagefindPageData>;
}

interface PagefindPageData {
    url?: string;
    meta?: { title?: string };
    sub_results?: { title?: string }[];
    score?: number;
}

interface SearchResultItem {
    title: string;
    url: string;
    breadcrumbs: string[];
    heading: string;
    score: number;
}

let pagefind: PagefindModule | null = null;
let loadPromise: Promise<void> | null = null;

async function preloadSearchIndex(log?: (event: string, data?: JsonObject) => void) {
    if (!loadPromise) {
        log?.('tool.search_docs.preload.start');
        loadPromise = import(/* webpackIgnore: true */ PAGEFIND_MODULE_URL)
            .then(async (pf: PagefindModule) => {
                await pf.init();
                pagefind = pf;
                log?.('tool.search_docs.preload.end');
            })
            .catch((error: Error) => {
                loadPromise = null;
                log?.('tool.search_docs.preload.error', { error: error.message });
                throw error;
            });
    }

    return loadPromise;
}

async function searchDocsIndex(query: string, log?: (event: string, data?: JsonObject) => void) {
    await preloadSearchIndex(log);
    if (!pagefind) {
        throw new Error('检索引擎异常');
    }
    return pagefind.search(query);
}

class SearchDocsTool extends Tool {
    name = 'search_docs';
    description = '搜索文档。输入关键词，返回匹配的文档标题和链接。用于找到与用户问题相关的文档。';
    input_schema: ToolInputSchema = {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: '搜索关键词，如"支付"、"登录"、"微信分享"等',
            },
        },
        required: ['query'],
    };

    protected async execute(input: ToolInput, _context: ToolRunContext): Promise<ToolResult> {
        const query = typeof input.query === 'string' ? input.query : '';
        if (!query) return { result: '请提供搜索关键词' };

        logger('tool.search_docs.start', { query });

        let search: { results: PagefindResult[] };
        try {
            search = await searchDocsIndex(query, logger);
        } catch (error) {
            const message = errorMessage(error);
            logger('tool.search_docs.error', { query, error: message });
            return {
                result: `检索「${query}」失败：检索引擎异常。`,
                events: [{ type: 'search_error', data: { query, error: message } }],
            };
        }

        const dataResults = await Promise.all(
            search.results.slice(0, 8).map(r => r.data())
        );
        const results: SearchResultItem[] = [];
        for (const page of dataResults) {
            const url = page.url?.replace(/index\.html$/, '') || '';
            // const url = page.url?.replace(/index\.html$/, '').replace(/\/+$/, '') || '';
            results.push({
                title: page.meta?.title || '',
                url,
                breadcrumbs: [],
                heading: page.sub_results?.[0]?.title || '',
                score: page.score || 0,
            });
        }

        logger('tool.search_docs.end', {
            query,
            count: results.length,
            results: results.map(({ title, url, score }) => ({ title, url, score })),
        });

        if (results.length === 0) {
            return {
                result: `检索「${query}」，找到 0 篇相关文档，我尝试换个关键词继续检索。`,
                events: [{ type: 'search', data: { query, count: 0, results: toJsonResults(results) } }],
            };
        }

        const formatted = results.map((r, i) =>
            `${i + 1}. [${r.breadcrumbs.join(' > ')}] ${r.title}\n   URL: ${r.url}`
        ).join('\n');
        const titles = results
            .map(item => item.title || item.heading)
            .filter(Boolean)
            .slice(0, 2);
        const titleText = titles.length
            ? `：${titles.join('、')}${results.length > titles.length ? '等' : ''}`
            : '';

        return {
            result: `检索「${query}」，找到 ${results.length} 篇相关文档${titleText}\n\n${formatted}`,
            events: [{ type: 'search', data: { query, count: results.length, results: toJsonResults(results) } }],
        };
    }
}

export default new SearchDocsTool();

function toJsonResults(results: readonly SearchResultItem[]): JsonObject[] {
    return results.map(result => ({
        breadcrumbs: result.breadcrumbs,
        heading: result.heading,
        score: result.score,
        title: result.title,
        url: result.url,
    }));
}
