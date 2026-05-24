import type { JsonObject, JsonValue, ToolDefinition } from '../tools/Tool';
import { withRetry } from '../utils/retry';

// ─── 通用类型 ────────────────────────────────────────

export interface ModelConfig {
    url?: string;
    streamUrl?: string;
    model?: string;
    personalAccessToken?: string;
}

export type ProviderPayload = JsonValue;
export type ProviderRequestBody = JsonObject;
export type ProviderResponseBody = JsonObject;
export type ProviderToolDefinition = ToolDefinition | JsonObject;

/** provider 无关的消息包装，payload 由具体 provider 适配器定义。 */
export interface ModelMessage<T extends ProviderPayload = ProviderPayload> {
    provider: string;
    payload: T;
}

/** provider 无关的单次模型请求。 */
export interface ModelRequest {
    messages: ModelMessage[];
    tools?: ToolDefinition[];
    system?: string;
    signal?: AbortSignal;
    /** 子询问等场景可禁用工具，避免模型继续递归调用工具。 */
    toolChoice?: 'auto' | 'none' | { name: string };
}

/** 工具调用。 */
export interface ToolCall {
    id: string;
    name: string;
    input: JsonObject;
    result?: JsonValue;
}

/** 聚合后的模型响应，主要给非流式调用和测试使用。 */
export interface ModelResponse {
    content: string;
    thinking?: string;
    toolCalls: ToolCall[];
    raw?: ModelMessage;
    status: 'tool' | 'continue' | 'final';
}

/** 模型输出事件。agent loop 默认消费这个事件流。 */
export type ModelEvent =
    | { type: 'content_delta'; content: string }
    | { type: 'thinking_delta'; content: string }
    | { type: 'tool_call_start'; callId: string; name: string }
    | { type: 'tool_call_delta'; callId: string; inputDelta: string }
    | { type: 'tool_call_done'; call: ToolCall }
    | { type: 'done'; response: ModelResponse }
    | { type: 'error'; error: Error };

// ─── 基类 ───────────────────────────────────────────

/**
 * Model 基类：统一 LLM provider 协议差异。
 *
 * 标准 agent 的主路径是 stream-first：core 只依赖 stream()。
 * 非流式 complete() 由基类消费 stream() 聚合出来，避免每个 provider
 * 同时维护两套解析逻辑。
 */
export abstract class Model {
    protected url: string;
    protected streamUrl?: string;
    protected model: string;
    protected personalAccessToken?: string;

    constructor({ url = '', streamUrl, model = '', personalAccessToken }: ModelConfig = {}) {
        this.url = url;
        this.streamUrl = streamUrl;
        this.model = model;
        this.personalAccessToken = personalAccessToken;
    }

    // ─── 核心方法（子类必须实现） ─────────────────────

    /**
     * 一轮对话的事件流。
     *
     * OpenAI / Claude / Gemini 都可以在 provider 内部选择真正的流式接口，
     * 或用非流式响应模拟事件流；对 agent loop 来说只认统一事件。
     */
    abstract stream(request: ModelRequest): AsyncGenerator<ModelEvent, void, void>;

    /**
     * 将业务消息列表转为当前 provider 的消息包装。
     */
    abstract toApiMessages(messages: readonly ModelMessage[]): ModelMessage[];

    /**
     * 创建工具结果消息。
     */
    abstract createToolResultMsg(toolUseId: string, content: JsonValue): ModelMessage;

    /**
     * 创建用户消息。
     */
    abstract createUserMsg(content: string): ModelMessage;

    /**
     * 创建助手文本消息。
     */
    abstract createAssistantTextMsg(content: string): ModelMessage;

    // ─── 便捷方法（子类通常不用覆盖） ─────────────────

    /**
     * 非流式便捷调用。
     *
     * 标准 agent 不直接依赖它；工具子询问、测试、批处理等需要完整文本时使用。
     */
    async complete(request: ModelRequest): Promise<ModelResponse> {
        for await (const event of this.stream(request)) {
            switch (event.type) {
                case 'done':
                    return event.response;
                case 'error':
                    throw event.error;
            }
        }

        throw new Error('Model.stream() ended without a done(response) event');
    }

    /**
     * 格式化工具定义为 provider 格式。
     *
     * 具体 provider 调 API 前可调用它；core 不依赖 provider 格式。
     */
    formatToolDefs(tools: ToolDefinition[]): ProviderToolDefinition[] {
        return tools;
    }

    /**
     * 判断是否可以在此位置安全压缩。
     *
     * 压缩工具裁剪上下文时需要知道哪些消息之间不能断开，
     * 例如 tool_call 和 tool_result 之间不能插入压缩边界。
     */
    isSafeCompactBoundary(previous: ModelMessage, current: ModelMessage): boolean {
        return true;
    }

    // ─── 通用工具方法 ────────────────────────────────

    /** 构建请求 URL。 */
    protected buildUrl(): string {
        return this.url;
    }

    /** 构建请求头。 */
    protected buildHeaders(): Record<string, string> {
        return { 'Content-Type': 'application/json' };
    }

    /** 带重试的 fetch。 */
    protected async fetchWithRetry(body: ProviderRequestBody, signal?: AbortSignal, url = this.buildUrl()): Promise<Response> {
        return withRetry(async (sig) => {
            const res = await fetch(url, {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify(body),
                signal: sig,
            });
            if (!res.ok) {
                const text = await res.text();
                const error = new Error(`API ${res.status}: ${text.slice(0, 200)}`) as Error & { status?: number };
                error.status = res.status;
                throw error;
            }
            return res;
        }, { signal });
    }

    /** fetch 并解析 JSON。 */
    protected async fetchJson(body: ProviderRequestBody, signal?: AbortSignal, url = this.buildUrl()): Promise<ProviderResponseBody> {
        const res = await this.fetchWithRetry(body, signal, url);
        return await res.json() as ProviderResponseBody;
    }

    /** 提取 <think> 标签中的思考内容。 */
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
