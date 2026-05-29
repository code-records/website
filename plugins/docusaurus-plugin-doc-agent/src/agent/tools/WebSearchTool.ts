import {
    Tool,
    type JsonObject,
    type JsonValue,
    type ToolActivity,
    type ToolAskPrompt,
    type ToolInput,
    type ToolPromptSchema,
    type ToolResult,
    type ToolRunContext,
} from './tool/Tool';

export interface WebSearchToolOptions {
    formatResults?: (data: JsonValue, query: string) => string;
    maxResults?: number;
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
        formatResults,
        maxResults = 5,
    }: WebSearchToolOptions = {}) {
        super();
        this.formatResults = formatResults;
        this.maxResults = maxResults;
    }

    formatActivity(_input: ToolInput): ToolActivity {
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

    protected async executeSearch(query: string, _context: ToolRunContext): Promise<ToolResult> {
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
