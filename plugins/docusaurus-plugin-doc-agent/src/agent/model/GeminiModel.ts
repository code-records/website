import { Model, type ModelConfig, type ModelEvent, type ModelMessage, type ModelRequest, type ModelResponse, type ToolCall } from './Model';
import type { JsonObject, JsonValue, ToolDefinition } from '../tools/Tool';
import { optionalString, requireJsonObject, requireString } from '../utils/json';
import { parseSseStream } from '../utils/sse';

const DEFAULT_GEMINI_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';
const DEFAULT_GEMINI_STREAM_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse';

type GeminiMessage = ModelMessage<JsonObject>;

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
        const body = this.buildGenerateContentBody(request.messages, request.tools ?? [], request.system ?? '');
        const res = await this.fetchWithRetry(body, request.signal, this.buildStreamUrl());
        const parts: JsonValue[] = [];
        const toolCalls: ToolCall[] = [];
        let content = '';
        let finishReason = '';

        for await (const event of parseSseStream(res, { idleTimeout: 30000, signal: request.signal })) {
            if (event.error !== undefined) {
                const error = requireJsonObject(event.error, 'Gemini stream error');
                yield { type: 'error', error: new Error(optionalString(error.message) || 'Gemini stream failed') };
                return;
            }

            if (event.candidates === undefined) continue;
            if (!Array.isArray(event.candidates)) {
                throw new Error('Gemini candidates must be an array');
            }

            for (const candidateValue of event.candidates) {
                const candidate = requireJsonObject(candidateValue, 'Gemini candidate');
                finishReason = optionalString(candidate.finishReason) || finishReason;
                const candidateContent = requireJsonObject(candidate.content, 'Gemini candidate content');
                if (!Array.isArray(candidateContent.parts)) {
                    throw new Error('Gemini content parts must be an array');
                }

                for (const partValue of candidateContent.parts) {
                    const part = requireJsonObject(partValue, 'Gemini content part');
                    parts.push(part);

                    const text = optionalString(part.text);
                    if (text.length > 0) {
                        content += text;
                        yield { type: 'content_delta', content: text };
                    }

                    if (part.functionCall !== undefined) {
                        const functionCall = requireJsonObject(part.functionCall, 'Gemini function call');
                        const call = this.createToolCall(functionCall, toolCalls.length);
                        toolCalls.push(call);
                        this.toolNamesById.set(call.id, call.name);
                        yield { type: 'tool_call_start', callId: call.id, name: call.name };
                        yield { type: 'tool_call_done', call };
                    }
                }
            }
        }

        yield {
            type: 'done',
            response: {
                content,
                raw: this.createModelMsg(parts),
                status: toolCalls.length > 0
                    ? 'tool'
                    : finishReason === 'MAX_TOKENS'
                        ? 'continue'
                        : 'final',
                toolCalls,
            },
        };
    }

    override async complete(request: ModelRequest): Promise<ModelResponse> {
        const body = this.buildGenerateContentBody(request.messages, request.tools ?? [], request.system ?? '');
        const json = await this.fetchJson(body, request.signal, this.buildGenerateUrl());
        return this.parseGenerateContentResponse(json);
    }

    toApiMessages(messages: readonly ModelMessage[]): ModelMessage[] {
        return messages.filter(message => message.provider === 'gemini');
    }

    createToolResultMsg(toolUseId: string, content: JsonValue): GeminiMessage {
        const name = this.toolNamesById.get(toolUseId) || toolUseId;
        return this.wrap({
            parts: [{
                functionResponse: {
                    id: toolUseId,
                    name,
                    response: { result: content },
                },
            }],
            role: 'user',
        });
    }

    createUserMsg(content: string): GeminiMessage {
        return this.wrap({ parts: [{ text: content }], role: 'user' });
    }

    createAssistantTextMsg(content: string): GeminiMessage {
        return this.createModelMsg(content.length > 0 ? [{ text: content }] : []);
    }

    override formatToolDefs(tools: ToolDefinition[]): JsonObject[] {
        return tools.map(tool => ({
            description: tool.description,
            name: tool.name,
            parameters: normalizeSchema(tool.input_schema),
        }));
    }

    override isSafeCompactBoundary(previous: ModelMessage, current: ModelMessage): boolean {
        if (previous.provider === 'gemini') {
            const payload = requireJsonObject(previous.payload, 'Gemini previous payload');
            if (Array.isArray(payload.parts) && payload.parts.some(part => isJsonObject(part) && isJsonObject(part.functionCall))) {
                return false;
            }
        }
        if (current.provider === 'gemini') {
            const payload = requireJsonObject(current.payload, 'Gemini current payload');
            if (Array.isArray(payload.parts) && payload.parts.some(part => isJsonObject(part) && isJsonObject(part.functionResponse))) {
                return false;
            }
        }
        return true;
    }

    private buildGenerateContentBody(messages: readonly ModelMessage[], toolDefs: readonly ToolDefinition[], system: string): JsonObject {
        return {
            contents: this.toContents(messages),
            ...(system.length > 0 ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            ...(toolDefs.length > 0
                ? {
                    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
                    tools: [{ functionDeclarations: this.formatToolDefs([...toolDefs]) }],
                }
                : {}),
        };
    }

    private toContents(messages: readonly ModelMessage[]): JsonValue[] {
        return this.toApiMessages(messages)
            .map(message => {
                const payload = requireJsonObject(message.payload, 'Gemini message payload');
                const role = payload.role === 'model' ? 'model' : 'user';
                if (!Array.isArray(payload.parts)) {
                    throw new Error('Gemini message parts must be an array');
                }
                return {
                    parts: payload.parts,
                    role,
                };
            })
            .filter(message => message.parts.length > 0);
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

    private createModelMsg(parts: JsonValue[]): GeminiMessage {
        return this.wrap({ parts, role: 'model' });
    }

    private wrap(payload: JsonObject): GeminiMessage {
        return { payload, provider: 'gemini' };
    }

    private buildGenerateUrl(): string {
        return this.withApiKey(this.applyModelTemplate(this.url));
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

    private parseGenerateContentResponse(response: JsonObject): ModelResponse {
        const parts: JsonValue[] = [];
        const toolCalls: ToolCall[] = [];
        let content = '';
        let finishReason = '';

        if (response.candidates === undefined) {
            return { content, raw: this.createModelMsg(parts), status: 'final', toolCalls };
        }
        if (!Array.isArray(response.candidates)) {
            throw new Error('Gemini candidates must be an array');
        }

        for (const candidateValue of response.candidates) {
            const candidate = requireJsonObject(candidateValue, 'Gemini candidate');
            finishReason = optionalString(candidate.finishReason) || finishReason;
            const candidateContent = requireJsonObject(candidate.content, 'Gemini candidate content');
            if (!Array.isArray(candidateContent.parts)) {
                throw new Error('Gemini content parts must be an array');
            }

            for (const partValue of candidateContent.parts) {
                const part = requireJsonObject(partValue, 'Gemini content part');
                parts.push(part);

                const text = optionalString(part.text);
                if (text.length > 0) {
                    content += text;
                }

                if (part.functionCall !== undefined) {
                    const functionCall = requireJsonObject(part.functionCall, 'Gemini function call');
                    const call = this.createToolCall(functionCall, toolCalls.length);
                    toolCalls.push(call);
                    this.toolNamesById.set(call.id, call.name);
                }
            }
        }

        return {
            content,
            raw: this.createModelMsg(parts),
            status: toolCalls.length > 0
                ? 'tool'
                : finishReason === 'MAX_TOKENS'
                    ? 'continue'
                    : 'final',
            toolCalls,
        };
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
        schema.items = normalizeSchema(items);
    }

    return schema;
}

function isJsonObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
