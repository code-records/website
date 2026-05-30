import {
    Tool,
    type JsonObject,
    type JsonValue,
    type ToolUsage,
    type ToolInput,
    type ToolPromptSchema,
    type ToolResult,
    type ToolRunContext,
} from './tool/Tool';

export interface WebSearchToolOptions {
    formatResults?: (data: JsonValue, query: string) => string;
    maxResults?: number;
    proxyEndpoint?: string;
}

export class WebSearchTool extends Tool {
    name = 'web_search';
    description = 'Search the internet for up-to-date information when local context is insufficient.';
    prompt: ToolPromptSchema = {
        properties: {
            query: {
                description: 'Search query',
                type: 'string',
            },
        },
        required: ['query'],
        type: 'object',
    };

    protected readonly formatResults?: (data: JsonValue, query: string) => string;
    protected readonly maxResults: number;
    private readonly proxyEndpoint: string;

    constructor({
        formatResults,
        maxResults = 5,
        proxyEndpoint = '/agent/v1/search',
    }: WebSearchToolOptions = {}) {
        super();
        this.formatResults = formatResults;
        this.maxResults = maxResults;
        this.proxyEndpoint = proxyEndpoint;
    }

    formatUsage(_input: ToolInput): ToolUsage {
        return {
            name: '网站',
            unit: '个',
            verb: '搜索',
        };
    }

    protected async execute(input: ToolInput, context: ToolRunContext): Promise<ToolResult> {
        const query = typeof input.query === 'string' ? input.query.trim() : '';
        if (query.length === 0) {
            return { result: 'Search failed: query is required.' };
        }

        return this.executeSearch(query, context);
    }

    protected async executeSearch(query: string, context: ToolRunContext): Promise<ToolResult> {
        const url = `${this.proxyEndpoint}?q=${encodeURIComponent(query)}&limit=${this.maxResults}`;

        try {
            const response = await fetch(url, { signal: context.signal });
            if (!response.ok) {
                const text = await response.text();
                return { result: `[Search Error] ${response.status}: ${text.slice(0, 200)}` };
            }

            const data = await response.json() as JsonValue;
            const resultCount = this.countResults(data);

            return {
                usage: {
                    count: resultCount,
                    name: '网站',
                    unit: '个',
                    verb: '搜索',
                },
                events: [{
                    data: {
                        mode: 'browser_proxy',
                        query,
                        resultCount,
                    },
                    type: 'web_search',
                }],
                result: this.formatSearchResults(data, query),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { result: `[Search Error] ${message}` };
        }
    }

    protected formatSearchResults(data: JsonValue, query: string): string {
        return this.formatResults !== undefined
            ? this.formatResults(data, query)
            : defaultFormatResults(data, query);
    }

    protected countResults(data: JsonValue): number {
        return getResults(data).length;
    }
}

export function createWebSearchTool(options?: WebSearchToolOptions): WebSearchTool {
    return new WebSearchTool(options);
}

function defaultFormatResults(data: JsonValue, query: string): string {
    const results = getResults(data);
    if (results.length === 0) {
        return `No results found for "${query}".`;
    }

    const formatted = results.map((item, index) => {
        const record = isJsonObject(item) ? item : {};
        const title = pickString(record, 'title', 'name') || '(untitled)';
        const url = pickString(record, 'url', 'link');
        const snippet = pickString(record, 'snippet', 'description', 'content');
        return `${index + 1}. ${title}\n   ${url}\n   ${snippet}`;
    }).join('\n\n');

    return `Search results for "${query}":\n\n${formatted}`;
}

function getResults(data: JsonValue): JsonValue[] {
    if (Array.isArray(data)) {
        return data;
    }

    if (!isJsonObject(data)) {
        return [];
    }

    const results = data.results;
    if (Array.isArray(results)) {
        return results;
    }

    const items = data.items;
    return Array.isArray(items) ? items : [];
}

function pickString(record: JsonObject, ...keys: string[]): string {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string') {
            return value;
        }
    }
    return '';
}

function isJsonObject(value: JsonValue): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
