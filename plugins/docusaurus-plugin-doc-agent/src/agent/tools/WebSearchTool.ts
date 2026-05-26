import { Tool, type JsonObject, type JsonValue, type ToolAskPrompt, type ToolInput, type ToolInputSchema, type ToolResult, type ToolRunContext } from './tool/Tool';

export interface WebSearchToolOptions {
    endpoint?: string;
    formatResults?: (data: JsonValue, query: string) => string;
    maxResults?: number;
    mode?: 'model' | 'proxy';
}

interface WebSearchAskInput extends JsonObject {
    maxResults: number;
    query: string;
}

interface WebSearchAskOutput extends JsonObject {
    result: string;
}

export class WebSearchTool extends Tool {
    name = 'web_search';
    description = 'Search the internet for up-to-date information when local context is insufficient.';
    input_schema: ToolInputSchema = {
        properties: {
            query: {
                description: 'Search query',
                type: 'string',
            },
        },
        required: ['query'],
        type: 'object',
    };

    private readonly endpoint: string;
    private readonly formatResults?: (data: JsonValue, query: string) => string;
    private readonly maxResults: number;
    private readonly mode: 'model' | 'proxy';

    private readonly searchPrompt: ToolAskPrompt<WebSearchAskInput, WebSearchAskOutput> = {
        name: 'web_search.model',
        build: input => [
            `Search for: ${input.query}`,
            `Return up to ${input.maxResults} useful results.`,
            'Include titles, URLs when available, and short summaries.',
        ].join('\n'),
        parse: content => ({ result: content.trim() }),
    };

    constructor({
        endpoint = '/agent/v1/search',
        formatResults,
        maxResults = 5,
        mode = 'proxy',
    }: WebSearchToolOptions = {}) {
        super();
        this.endpoint = endpoint;
        this.formatResults = formatResults;
        this.maxResults = maxResults;
        this.mode = mode;
    }

    protected async execute(input: ToolInput, context: ToolRunContext): Promise<ToolResult> {
        const query = typeof input.query === 'string' ? input.query.trim() : '';
        if (query.length === 0) {
            return { result: 'Search failed: query is required.' };
        }

        if (this.mode === 'model') {
            const answer = await this.askModel({
                input: {
                    maxResults: this.maxResults,
                    query,
                },
                prompt: this.searchPrompt,
            });
            return {
                events: [{
                    data: {
                        mode: 'model',
                        query,
                    },
                    type: 'web_search',
                }],
                result: answer.result,
            };
        }

        return this.executeProxy(query, context.signal);
    }

    private async executeProxy(query: string, signal?: AbortSignal): Promise<ToolResult> {
        const url = `${this.endpoint}?q=${encodeURIComponent(query)}&limit=${this.maxResults}`;

        try {
            const response = await fetch(url, { signal });
            if (!response.ok) {
                const text = await response.text();
                return { result: `[Search Error] ${response.status}: ${text.slice(0, 200)}` };
            }

            const data = await response.json() as JsonValue;
            const result = this.formatResults !== undefined
                ? this.formatResults(data, query)
                : defaultFormatResults(data, query);

            return {
                events: [{
                    data: {
                        mode: 'proxy',
                        query,
                        resultCount: countResults(data),
                    },
                    type: 'web_search',
                }],
                result,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { result: `[Search Error] ${message}` };
        }
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

function countResults(data: JsonValue): number {
    return getResults(data).length;
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
