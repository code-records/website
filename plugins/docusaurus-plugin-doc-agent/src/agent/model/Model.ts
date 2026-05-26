import type { JsonObject, JsonValue, ToolDefinition } from '../tools/Tool';
import type { Message } from '../chat/Message';
import type { ToolCall } from '../core/ToolCall';

// ─── 通用类型 ────────────────────────────────────────

export interface ModelConfig {
    model?: string;
    streamUrl?: string;
    url?: string;
    personalAccessToken?: string;
}

export type ProviderRequestBody = JsonObject;
export type ProviderResponseBody = JsonObject;
export type ProviderMessage = JsonObject;
export type ProviderStreamChunk = JsonValue;

export type ModelAction =
    | { type: 'thinking'; content: string }
    | { type: 'tool'; call: ToolCall };
export type { ToolCall };

/** provider 无关的单次模型请求。 */
export interface ModelRequest {
    messages: readonly Message[];
    /** 工具向模型发起的一次性回问，不写入长期 Message[]。 */
    toolAsk?: string;
    tools?: ToolDefinition[];
    system?: string;
    signal?: AbortSignal;
    /** 子询问等场景可禁用工具，避免模型继续递归调用工具。 */
    toolChoice?: 'auto' | 'none' | { name: string };
}

/** 聚合后的模型响应，主要给非流式调用和测试使用。 */
export interface ModelResponse {
    content: string;
    actions: ModelAction[];
    status: 'tool' | 'continue' | 'final';
}

export type ModelActionEventKind = 'add' | 'update';

/** 模型输出事件。agent loop 默认消费这个事件流。 */
export type ModelEvent =
    | { type: 'content_delta'; content: string }
    | { type: 'action'; action: ModelAction; kind: ModelActionEventKind }
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
    protected model: string;
    protected streamUrl?: string;
    protected url: string;
    protected personalAccessToken?: string;

    constructor({ model = '', personalAccessToken, streamUrl, url = '' }: ModelConfig = {}) {
        this.model = model;
        this.streamUrl = streamUrl;
        this.url = url;
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
     * 发起 provider 非流式请求。
     *
     * 子类负责错误解析、重试策略和 provider 特有响应处理。
     */
    protected abstract request(body: ProviderRequestBody, signal?: AbortSignal): Promise<ProviderResponseBody>;

    /**
     * 发起 provider 流式请求。
     *
     * 不支持原生流式的 provider 也需要在子类中用非流式响应模拟 chunk。
     */
    protected abstract requestStream(body: ProviderRequestBody, signal?: AbortSignal): AsyncGenerator<ProviderStreamChunk, void, void>;

    /**
     * 将一条公共 Message 展开成 provider 请求片段。
     *
     * 一条公共 assistant Message 可能包含最终文本、round、tool call、tool result，
     * 所以展开结果允许是 0..N 条 provider message。
     */
    protected abstract expandMessageToProviderMessages(message: Message): ProviderMessage[];

    /**
     * 将工具回问展开成 provider 请求片段。
     *
     * toolAsk 只服务于 Tool.askModel() 这条链路，不进入长期 Message[]。
     */
    protected abstract expandToolAskToProviderMessages(toolAsk: string): ProviderMessage[];

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
     * 构建完整 provider messages。
     *
     * 基类只负责统一遍历公共 Message[] 和追加工具回问；
     * provider 具体格式由子类的 expand* 方法决定。
     */
    protected buildProviderMessages(messages: readonly Message[], toolAsk?: string): ProviderMessage[] {
        const result = messages.flatMap(message => this.expandMessageToProviderMessages(message));
        if (toolAsk !== undefined && toolAsk.length > 0) {
            result.push(...this.expandToolAskToProviderMessages(toolAsk));
        }
        return result;
    }

}
