import { WebSearchTool, type WebSearchToolOptions } from '../WebSearchTool';
import type { JsonValue, ToolResult, ToolRunContext } from '../tool/Tool';

export interface BrowserWebSearchToolOptions extends WebSearchToolOptions {
    proxyEndpoint?: string;
}

export class BrowserWebSearchTool extends WebSearchTool {
    private readonly proxyEndpoint: string;

    constructor({
        proxyEndpoint = '/agent/v1/search',
        ...options
    }: BrowserWebSearchToolOptions = {}) {
        super(options);
        this.proxyEndpoint = proxyEndpoint;
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
}

export function createBrowserWebSearchTool(options?: BrowserWebSearchToolOptions): BrowserWebSearchTool {
    return new BrowserWebSearchTool(options);
}
