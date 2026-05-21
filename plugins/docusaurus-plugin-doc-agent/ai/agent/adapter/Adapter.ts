import { parseSseStream } from '../utils/utils';
import { withRetry } from '../utils/retry';
import type {
    StreamActionCallback,
    AdapterChatResponse,
    AdapterMessage,
    AdapterMessageList,
    AdapterConfig,
    MessageList,
    RuntimeTool,
    StreamEvent,
    ToolDefinitionList,
    UnknownRecord,
} from '../types';

function requireRecord(value: unknown, context: string): UnknownRecord {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return value as UnknownRecord;
    }
    throw new Error(`${context} must be an object`);
}

export abstract class Adapter {
    protected endpoint: string;
    protected model: string;

    constructor({ endpoint = '', model = '' }: AdapterConfig = {}) {
        this.endpoint = endpoint;
        this.model = model;
    }

    /**
     * 执行一轮 LLM 对话，支持两种模式：
     *
     * - **接口模式**：不传 onStreamAction，等本轮完整结果返回后再由 loop 执行工具、发起下一轮。
     * - **流模式**：传入 onStreamAction 回调，解析过程中实时推送每个 action（文本/工具调用/thinking），
     *   使 UI 能在单轮内增量渲染。最终仍返回完整的 AdapterChatResponse。
     *
     * 两种模式共用同一份 SSE 解析逻辑，多轮循环由 loop 驱动，与此方法无关。
     */
    abstract chat(messages: AdapterMessageList, toolDefs: ToolDefinitionList, system: string, signal?: AbortSignal, onStreamAction?: StreamActionCallback): Promise<AdapterChatResponse>;
    abstract createAssistantTextMsg(content: string): AdapterMessage;
    abstract createUserMsg(content: string): AdapterMessage;
    abstract createToolResultMsg(toolUseId: string, content: unknown): AdapterMessage;
    abstract formatToolDefs(tools: RuntimeTool[]): ToolDefinitionList;
    abstract toApiMessages(messages: MessageList): AdapterMessageList;

    isSafeCompactBoundary(previous: AdapterMessage, current: AdapterMessage): boolean {
        if (this.isToolCallMessage(previous)) return false;
        if (this.isToolResultMessage(current)) return false;
        return true;
    }

    async *stream(messages: AdapterMessageList, system: string, signal?: AbortSignal): AsyncGenerator<StreamEvent, void, void> {
        const body = this.buildStreamBody(messages, system);
        const res = await this.fetchWithRetry(body, signal);

        let hasContent = false;
        for await (const json of parseSseStream(res, { idleTimeout: 30000, signal })) {
            const text = this.parseStreamEvent(json);
            if (text === null) break;
            if (text !== undefined) {
                hasContent = true;
                yield { type: 'text_delta', content: text };
            }
        }

        if (!hasContent) throw new Error('Stream returned empty response');
        yield { type: 'done' };
    }

    protected abstract buildStreamBody(messages: AdapterMessageList, system: string): unknown;

    /** Return text content, null to stop, undefined to skip */
    protected abstract parseStreamEvent(json: UnknownRecord): string | null | undefined;

    protected async fetchWithRetry(body: unknown, signal?: AbortSignal): Promise<Response> {
        return withRetry(async (sig) => {
            const res = await fetch(this.buildUrl(), {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify(body),
                signal: sig,
            });
            if (!res.ok) {
                const text = await res.text();
                const err = new Error(`API ${res.status}: ${text.slice(0, 200)}`);
                (err as unknown as UnknownRecord).status = res.status;
                throw err;
            }
            return res;
        }, { signal });
    }

    protected async fetchJson(body: unknown, signal?: AbortSignal): Promise<UnknownRecord> {
        const res = await this.fetchWithRetry(body, signal);
        return requireRecord(await res.json(), 'API response');
    }

    protected buildHeaders(): Record<string, string> {
        return { 'Content-Type': 'application/json' };
    }

    protected buildUrl(): string {
        return this.endpoint;
    }

    protected isToolCallMessage(_message: AdapterMessage): boolean {
        return false;
    }

    protected isToolResultMessage(_message: AdapterMessage): boolean {
        return false;
    }

    protected extractThinking(text: string): { content: string; thinking?: string } {
        const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
        let thinking = '';
        let match = thinkRegex.exec(text);
        while (match !== null) {
            thinking += match[1];
            match = thinkRegex.exec(text);
        }
        const content = text
            .replace(thinkRegex, '')
            .replace(/<think>[\s\S]*$/i, '')
            .replace(/<\/think>/gi, '')
            .trim();
        thinking = thinking.trim();
        return thinking ? { content, thinking } : { content };
    }
}
