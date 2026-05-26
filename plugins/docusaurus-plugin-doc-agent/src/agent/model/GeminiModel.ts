import {
    Model,
    type ModelAction,
    type ModelConfig,
    type ModelEvent,
    type ModelRequest,
    type ModelResponse,
    type ProviderMessage,
    type ProviderRequestBody,
    type ProviderResponseBody,
    type ProviderStreamChunk,
    type ToolCall,
} from './Model';
import type { Message } from '../chat/Message';
import type { JsonObject, JsonValue, ToolDefinition } from '../tools/Tool';
import { optionalString, requireJsonObject, requireString } from '../utils/json';
import { parseSseStream } from '../utils/sse';

const DEFAULT_GEMINI_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';
const DEFAULT_GEMINI_STREAM_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse';

export class GeminiModel extends Model {
    private readonly toolNamesById = new Map<string, string>();

    constructor({ url = DEFAULT_GEMINI_GENERATE_URL, streamUrl = DEFAULT_GEMINI_STREAM_URL, ...rest }: ModelConfig = {}) {
        super({
            url: url || DEFAULT_GEMINI_GENERATE_URL,
            streamUrl: streamUrl || DEFAULT_GEMINI_STREAM_URL,
            ...rest,
        });
    }

    async *stream(request: ModelRequest): AsyncGenerator<ModelEvent, void, void> {
        const body = this.buildGenerateContentBody(request.messages, request.tools ?? [], request.system ?? '', request.toolAsk);
        const parts: JsonValue[] = [];
        const toolCalls: ToolCall[] = [];
        let content = '';
        let finishReason = '';

        for await (const chunk of this.requestStream(body, request.signal)) {
            const event = requireJsonObject(chunk, 'Gemini stream event');
            if (event.error !== undefined) {
                const error = requireJsonObject(event.error, 'Gemini stream error');
                yield { type: 'error', error: new Error(optionalString(error.message) || 'Gemini stream failed') };
                return;
            }

            if (event.candidates === undefined) continue;
            const parsed = this.parseCandidates(event);
            finishReason = parsed.finishReason || finishReason;
            parts.push(...parsed.parts);

            if (parsed.content.length > 0) {
                content += parsed.content;
                yield { type: 'content_delta', content: parsed.content };
            }

            for (const call of parsed.toolCalls) {
                toolCalls.push(call);
                this.toolNamesById.set(call.id, call.name);
                yield { type: 'action', action: { type: 'tool', call }, kind: 'add' };
            }
        }

        const actions = this.createActions(toolCalls);
        yield {
            type: 'done',
            response: {
                actions,
                content,
                status: toolCalls.length > 0
                    ? 'tool'
                    : finishReason === 'MAX_TOKENS'
                        ? 'continue'
                        : 'final',
            },
        };
    }

    override async complete(request: ModelRequest): Promise<ModelResponse> {
        const body = this.buildGenerateContentBody(request.messages, request.tools ?? [], request.system ?? '', request.toolAsk);
        const json = await this.request(body, request.signal);
        return this.parseGenerateContentResponse(json);
    }

    protected async request(body: ProviderRequestBody, signal?: AbortSignal): Promise<ProviderResponseBody> {
        const res = await this.postJson(this.buildGenerateUrl(), body, signal);
        return await res.json() as ProviderResponseBody;
    }

    protected async *requestStream(body: ProviderRequestBody, signal?: AbortSignal): AsyncGenerator<ProviderStreamChunk, void, void> {
        const res = await this.postJson(this.buildStreamUrl(), body, signal);
        for await (const event of parseSseStream(res, { idleTimeout: 30000, signal })) {
            yield event;
        }
    }

    protected expandMessageToProviderMessages(message: Message): ProviderMessage[] {
        if (message.local === true || message.content.length === 0) {
            return [];
        }
        if (message.role === 'user') {
            return [{ parts: [{ text: message.content }], role: 'user' }];
        }

        const parts: JsonValue[] = [];
        if (message.content.length > 0) {
            parts.push({ text: message.content });
        }
        const toolResultMessages: JsonObject[] = [];
        for (const action of this.roundToolActions(message)) {
            if (action.call !== undefined) {
                parts.push({
                    functionCall: {
                        args: action.call.input,
                        id: action.call.id,
                        name: action.call.name,
                    },
                });
                continue;
            }
            if (action.callId !== undefined && action.content.length > 0) {
                const name = this.toolNamesById.get(action.callId) || action.callId;
                toolResultMessages.push({
                    parts: [{
                        functionResponse: {
                            id: action.callId,
                            name,
                            response: { result: action.content },
                        },
                    }],
                    role: 'user',
                });
            }
        }

        return [
            ...(parts.length > 0 ? [{ parts, role: 'model' }] : []),
            ...toolResultMessages,
        ];
    }

    protected expandToolAskToProviderMessages(toolAsk: string): ProviderMessage[] {
        return [{ parts: [{ text: toolAsk }], role: 'user' }];
    }

    private buildGenerateContentBody(messages: readonly Message[], toolDefs: readonly ToolDefinition[], system: string, toolAsk?: string): JsonObject {
        return {
            contents: this.buildProviderMessages(messages, toolAsk),
            ...(system.length > 0 ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            ...(toolDefs.length > 0
                ? {
                    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
                    tools: [{ functionDeclarations: this.formatToolDefs(toolDefs) }],
                }
                : {}),
        };
    }

    private roundToolActions(message: Message): Array<{ call?: ToolCall; callId?: string; content: string }> {
        return (message.plan?.items ?? []).flatMap(round => round.items.flatMap(action => {
            if (action.type !== 'tool') {
                return [];
            }
            return [{
                call: action.call,
                callId: action.callId,
                content: action.content,
            }];
        }));
    }

    private formatToolDefs(tools: readonly ToolDefinition[]): JsonObject[] {
        return tools.map(tool => ({
            description: tool.description,
            name: tool.name,
            parameters: normalizeSchema(tool.input_schema),
        }));
    }

    private parseGenerateContentResponse(response: JsonObject): ModelResponse {
        if (response.candidates === undefined) {
            return {
                actions: [],
                content: '',
                status: 'final',
            };
        }

        const parsed = this.parseCandidates(response);
        for (const call of parsed.toolCalls) {
            this.toolNamesById.set(call.id, call.name);
        }
        const actions = this.createActions(parsed.toolCalls);

        return {
            actions,
            content: parsed.content,
            status: parsed.toolCalls.length > 0
                ? 'tool'
                : parsed.finishReason === 'MAX_TOKENS'
                    ? 'continue'
                    : 'final',
        };
    }

    private parseCandidates(response: JsonObject): { content: string; finishReason: string; parts: JsonValue[]; toolCalls: ToolCall[] } {
        if (!Array.isArray(response.candidates)) {
            throw new Error('Gemini candidates must be an array');
        }

        const parts: JsonValue[] = [];
        let content = '';
        let finishReason = '';
        const toolCalls: ToolCall[] = [];

        for (const candidateValue of response.candidates) {
            const candidate = requireJsonObject(candidateValue, 'Gemini candidate');
            finishReason = optionalString(candidate.finishReason) || finishReason;
            const candidateContent = requireJsonObject(candidate.content, 'Gemini candidate content');
            if (!Array.isArray(candidateContent.parts)) {
                throw new Error('Gemini content parts must be an array');
            }

            const parsed = this.parseParts(candidateContent.parts, toolCalls.length);
            content += parsed.content;
            parts.push(...parsed.parts);
            toolCalls.push(...parsed.toolCalls);
        }

        return { content, finishReason, parts, toolCalls };
    }

    private parseParts(parts: readonly JsonValue[], offset = 0): { content: string; parts: JsonValue[]; toolCalls: ToolCall[] } {
        let content = '';
        const toolCalls: ToolCall[] = [];

        for (const partValue of parts) {
            const part = requireJsonObject(partValue, 'Gemini content part');
            const text = optionalString(part.text);
            if (text.length > 0) {
                content += text;
            }

            if (part.functionCall !== undefined) {
                const functionCall = requireJsonObject(part.functionCall, 'Gemini function call');
                toolCalls.push(this.createToolCall(functionCall, offset + toolCalls.length));
            }
        }

        return { content, parts: [...parts], toolCalls };
    }

    private createToolCall(functionCall: JsonObject, index: number): ToolCall {
        const name = requireString(functionCall.name, 'Gemini function call name');
        const rawId = optionalString(functionCall.id);
        const id = rawId || `gemini_${name}_${index + 1}`;
        return {
            id,
            input: isJsonObject(functionCall.args) ? functionCall.args : {},
            name,
        };
    }

    private createActions(toolCalls: readonly ToolCall[]): ModelAction[] {
        return toolCalls.map(call => ({ type: 'tool' as const, call }));
    }

    private async postJson(url: string, body: ProviderRequestBody, signal?: AbortSignal): Promise<Response> {
        const res = await fetch(url, {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal,
        });
        if (!res.ok) {
            throw await this.createApiError(res);
        }
        return res;
    }

    private async createApiError(res: Response): Promise<Error> {
        const text = await res.text();
        try {
            const json = JSON.parse(text) as unknown;
            const body = requireJsonObject(json, 'Gemini error body');
            const error = requireJsonObject(body.error, 'Gemini error');
            return Object.assign(new Error(optionalString(error.message) || `Gemini API ${res.status}`), { status: res.status });
        } catch {
            return Object.assign(new Error(`Gemini API ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
        }
    }

    private buildGenerateUrl(): string {
        return this.withApiKey(this.applyModelTemplate(this.url || DEFAULT_GEMINI_GENERATE_URL));
    }

    private buildStreamUrl(): string {
        return this.withApiKey(ensureQueryParam(this.applyModelTemplate(this.streamUrl || DEFAULT_GEMINI_STREAM_URL), 'alt', 'sse'));
    }

    private applyModelTemplate(endpoint: string): string {
        const value = endpoint.trim().replace('{model}', encodeURIComponent(this.model));
        if (value.includes('{model}')) {
            throw new Error('Gemini endpoint template contains an invalid {model} placeholder');
        }
        return value;
    }

    private withApiKey(url: string): string {
        if (!this.personalAccessToken) return url;
        return ensureQueryParam(url, 'key', this.personalAccessToken);
    }
}

function ensureQueryParam(url: string, key: string, value: string): string {
    if (new RegExp(`(?:[?&])${escapeRegExp(key)}=`).test(url)) return url;
    return `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSchema(value: JsonValue): JsonObject {
    const schema = isJsonObject(value) ? { ...value } : {};
    if (typeof schema.type === 'string') {
        schema.type = schema.type.toUpperCase();
    }

    const properties = isJsonObject(schema.properties) ? schema.properties : {};
    if (Object.keys(properties).length > 0) {
        schema.properties = Object.fromEntries(
            Object.entries(properties).map(([key, child]) => [key, normalizeSchema(child)]),
        );
    }

    const items = isJsonObject(schema.items) ? schema.items : {};
    if (Object.keys(items).length > 0) {
        schema.items = normalizeSchema(schema.items);
    }

    return schema;
}

function isJsonObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
