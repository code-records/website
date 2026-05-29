import {
    Model,
    type ModelAction,
    type ModelConfig,
    type ModelEvent,
    type ModelRequest,
    type ModelResponse,
    type ModelResponseType,
    type ProviderMessage,
    type ProviderRequestBody,
    type ProviderResponseBody,
    type ProviderStreamChunk,
    type ModelToolCall,
} from './Model';
import type { Message } from '../chat/Message';
import type { JsonObject, JsonValue, ToolDefinition } from '../tools/tool/Tool';
import { optionalString, requireJsonObject, requireString } from '../utils/json';
import { parseSseStream } from '../utils/sse';

const DEFAULT_GEMINI_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';
const DEFAULT_GEMINI_STREAM_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse';

export class GeminiModel extends Model {
    private readonly toolNamesById = new Map<string, string>();

    constructor({ url = DEFAULT_GEMINI_GENERATE_URL, streamUrl = DEFAULT_GEMINI_STREAM_URL, ...rest }: ModelConfig) {
        super({
            url: url || DEFAULT_GEMINI_GENERATE_URL,
            streamUrl: streamUrl || DEFAULT_GEMINI_STREAM_URL,
            ...rest,
        });
    }

    async *stream(request: ModelRequest): AsyncGenerator<ModelEvent, void, void> {
        const body = this.buildGenerateContentBody(request.messages, request.tools ?? [], request.system ?? '', request.toolAsk);
        const parts: JsonValue[] = [];
        const toolCalls: ModelToolCall[] = [];
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
                yield {
                    type: 'content',
                    content: parsed.content,
                };
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
                responseStatus: this.resolveResponseStatus({ finishReason, parts }),
            },
        };
    }

    protected resolveResponseStatus(response: JsonObject): ModelResponseType {
        const finishReason = optionalString(response.finishReason);
        const parts = Array.isArray(response.parts) ? response.parts as JsonValue[] : [];
        if (parts.some(p => isJsonObject(p) && p.functionCall !== undefined)) return 'tool_calls';
        if (finishReason === 'MAX_TOKENS') return 'continue';
        return 'final';
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
        if (message.local === true) {
            return [];
        }
        if (message.role === 'user') {
            const text = message.plans[0]?.text ?? '';
            return text.length > 0
                ? [{ parts: [{ text }], role: 'user' }]
                : [];
        }

        const parts: JsonValue[] = [];
        const toolResultMessages: JsonObject[] = [];
        for (const round of message.plans[0]?.items ?? []) {
            if ((round.type === 'final' || round.type === 'continue') && round.text.length > 0) {
                parts.push({ text: round.text });
            }
        }
        for (const action of this.roundToolActions(message)) {
            parts.push({
                functionCall: {
                    args: action.call.input,
                    id: action.call.id,
                    name: action.call.name,
                },
            });
            if (action.text.length > 0) {
                toolResultMessages.push({
                    parts: [{
                        functionResponse: {
                            id: action.call.id,
                            name: action.call.name,
                            response: { result: action.text },
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

    private roundToolActions(message: Message): Array<{ call: ModelToolCall; text: string }> {
        return (message.plans[0]?.items ?? []).flatMap(round => round.items.flatMap(action => {
            if (action.type !== 'tool') {
                return [];
            }
            if (action.call === undefined) {
                throw new Error('Tool action must include call before provider conversion');
            }
            return [{
                call: action.call,
                text: action.text,
            }];
        }));
    }

    private formatToolDefs(tools: readonly ToolDefinition[]): JsonObject[] {
        return tools.map(tool => ({
            description: tool.description,
            name: tool.name,
            parameters: normalizeSchema(tool.prompt),
        }));
    }

    private parseGenerateContentResponse(response: JsonObject): ModelResponse {
        if (response.candidates === undefined) {
            return {
                actions: [],
                content: '',
                responseStatus: 'final',
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
            responseStatus: this.resolveResponseStatus({ finishReason: parsed.finishReason, parts: parsed.parts }),
        };
    }

    private parseCandidates(response: JsonObject): { content: string; finishReason: string; parts: JsonValue[]; toolCalls: ModelToolCall[] } {
        if (!Array.isArray(response.candidates)) {
            throw new Error('Gemini candidates must be an array');
        }

        const parts: JsonValue[] = [];
        let content = '';
        let finishReason = '';
        const toolCalls: ModelToolCall[] = [];

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

    private parseParts(parts: readonly JsonValue[], offset = 0): { content: string; parts: JsonValue[]; toolCalls: ModelToolCall[] } {
        let content = '';
        const toolCalls: ModelToolCall[] = [];

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

    private createToolCall(functionCall: JsonObject, index: number): ModelToolCall {
        const name = requireString(functionCall.name, 'Gemini function call name');
        const rawId = optionalString(functionCall.id);
        const id = rawId || `gemini_${name}_${index + 1}`;
        return {
            id,
            input: isJsonObject(functionCall.args) ? functionCall.args : {},
            name,
        };
    }

    private createActions(toolCalls: readonly ModelToolCall[]): ModelAction[] {
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




