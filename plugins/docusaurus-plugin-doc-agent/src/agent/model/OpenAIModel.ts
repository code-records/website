import {
    Model,
    type ModelAction,
    type ModelConfig,
    type ModelEvent,
    type ModelRequest,
    type ModelResponseStatus,
    type ProviderMessage,
    type ProviderRequestBody,
    type ProviderResponseBody,
    type ProviderStreamChunk,
    type ModelToolCall,
} from './Model';
import type { Message } from '../chat/Message';
import type { JsonObject, JsonValue, ToolDefinition } from '../tools/tool/Tool';
import { optionalArray, optionalString, requireJsonObject, requireString, safeParseJsonObject } from '../utils/json';
import { parseSseStream } from '../utils/sse';

const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_STREAM_ENDPOINT = DEFAULT_OPENAI_ENDPOINT;

export class OpenAIModel extends Model {
    constructor({ url = DEFAULT_OPENAI_ENDPOINT, streamUrl = DEFAULT_OPENAI_STREAM_ENDPOINT, ...rest }: ModelConfig) {
        super({
            url: url || DEFAULT_OPENAI_ENDPOINT,
            streamUrl: streamUrl || DEFAULT_OPENAI_STREAM_ENDPOINT,
            ...rest,
        });
    }

    async *stream(request: ModelRequest): AsyncGenerator<ModelEvent, void, void> {
        const body: ProviderRequestBody = {
            input: this.buildProviderMessages(request.messages, request.toolAsk),
            model: this.model,
            ...(request.system ? { instructions: request.system } : {}),
            ...(request.tools?.length ? { tools: this.formatToolDefs(request.tools) } : {}),
            stream: true,
        };

        const output: JsonValue[] = [];
        const toolCalls: ModelToolCall[] = [];
        const toolArgs = new Map<string, string>();
        const toolByItemId = new Map<string, ModelToolCall>();
        let finalStatus = '';
        let providerResponse: JsonObject = {};
        let content = '';
        let outputText = '';
        let thinking = '';
        let thinkingStarted = false;

        for await (const chunk of this.requestStream(body, request.signal)) {
            const event = requireJsonObject(chunk, 'OpenAI stream event');
            const type = requireString(event.type, 'OpenAI stream event type');

            if (type === 'response.output_item.added') {
                const item = requireJsonObject(event.item, 'OpenAI output item');
                if (item.type !== 'function_call') continue;

                const itemId = requireString(item.id, 'OpenAI output item id');
                const callId = typeof item.call_id === 'string' ? item.call_id : itemId;
                const name = requireString(item.name, 'OpenAI function call name');
                const call: ModelToolCall = { id: callId, input: {}, name };

                toolByItemId.set(itemId, call);
                toolArgs.set(itemId, optionalString(item.arguments));
                toolCalls.push(call);

                yield { type: 'action', action: { type: 'tool', call }, kind: 'add' };
                continue;
            }

            if (type === 'response.output_text.delta') {
                const delta = requireString(event.delta, 'OpenAI output text delta');
                content += delta;
                yield {
                    // !!!!!! 流式阶段无法可靠区分过程文本和最终正文，暂时统一发 content_delta
                    type: 'content_delta',
                    content: delta,
                };
                continue;
            }

            if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
                thinking += requireString(event.delta, 'OpenAI reasoning delta');
                yield {
                    type: 'action',
                    action: { type: 'thinking', content: thinking },
                    kind: thinkingStarted ? 'update' : 'add',
                };
                thinkingStarted = true;
                continue;
            }

            if (type === 'response.function_call_arguments.delta') {
                const itemId = requireString(event.item_id, 'OpenAI function call item_id');
                const delta = requireString(event.delta, 'OpenAI function call arguments delta');
                toolArgs.set(itemId, (toolArgs.get(itemId) ?? '') + delta);
                continue;
            }

            if (type === 'response.output_item.done') {
                const item = requireJsonObject(event.item, 'OpenAI completed output item');
                output.push(item);
                if (item.type === 'function_call') {
                    const itemId = requireString(item.id, 'OpenAI completed function call id');
                    const call = toolByItemId.get(itemId);
                    if (call !== undefined) {
                        call.input = safeParseJsonObject(optionalString(item.arguments) || toolArgs.get(itemId) || '');
                        yield { type: 'action', action: { type: 'tool', call }, kind: 'update' };
                    }
                }
                continue;
            }

            if (type === 'response.completed' || type === 'response.incomplete') {
                providerResponse = requireJsonObject(event.response, 'OpenAI response');
                finalStatus = requireString(providerResponse.status, 'OpenAI response status');
                outputText = optionalString(providerResponse.output_text);
                if (output.length === 0) {
                    output.push(...optionalArray(providerResponse.output));
                }
                break;
            }

            if (type === 'response.failed') {
                const response = requireJsonObject(event.response, 'OpenAI failed response');
                const error = requireJsonObject(response.error, 'OpenAI response error');
                yield { type: 'error', error: new Error(optionalString(error.message) || 'Responses stream failed') };
                return;
            }
        }

        const finalContent = outputText || content;
        if (finalContent.length > 0 && content.length === 0) {
            yield {
                // !!!!!! 流式阶段无法可靠区分过程文本和最终正文，暂时统一发 content_delta
                type: 'content_delta',
                content: finalContent,
            };
        }

        const actions = this.createActions(thinking, toolCalls);
        yield {
            type: 'done',
            response: {
                actions,
                content: finalContent,
                status: this.resolveStatus(providerResponse),
            },
        };
    }

    protected resolveStatus(response: JsonObject): ModelResponseStatus {
        if (optionalArray(response.output).some(o => isJsonObject(o) && o.type === 'function_call')) return 'tool';
        if (optionalString(response.status) === 'incomplete') return 'continue';
        return 'final';
    }

    protected async request(body: ProviderRequestBody, signal?: AbortSignal): Promise<ProviderResponseBody> {
        const res = await this.postJson(this.url || DEFAULT_OPENAI_ENDPOINT, body, signal);
        return await res.json() as ProviderResponseBody;
    }

    protected async *requestStream(body: ProviderRequestBody, signal?: AbortSignal): AsyncGenerator<ProviderStreamChunk, void, void> {
        const res = await this.postJson(this.streamUrl || this.url || DEFAULT_OPENAI_STREAM_ENDPOINT, body, signal);
        for await (const event of parseSseStream(res, { idleTimeout: 30000, signal })) {
            yield event;
        }
    }

    protected expandMessageToProviderMessages(message: Message): ProviderMessage[] {
        if (message.local === true) {
            return [];
        }
        if (message.role === 'user') {
            return message.content.length > 0
                ? [{ content: message.content, role: 'user' }]
                : [];
        }

        const result: JsonObject[] = [];
        const roundMessages = this.roundsToProviderMessages(message);
        if (message.content.length > 0) {
            result.push({ content: message.content, role: 'assistant' });
        }
        result.push(...roundMessages);

        return result;
    }

    protected expandToolAskToProviderMessages(toolAsk: string): ProviderMessage[] {
        return [{ content: toolAsk, role: 'user' }];
    }

    private roundsToProviderMessages(message: Message): JsonObject[] {
        const result: JsonObject[] = [];
        for (const round of message.plan?.items ?? []) {
            for (const action of round.items) {
                if (action.type !== 'tool') continue;
                if (action.call !== undefined) {
                    result.push({
                        arguments: JSON.stringify(action.call.input ?? {}),
                        call_id: action.call.id,
                        name: action.call.name,
                        type: 'function_call',
                    });
                    continue;
                }
                if (action.callId !== undefined && action.content.length > 0) {
                    result.push({
                        call_id: action.callId,
                        output: action.content,
                        type: 'function_call_output',
                    });
                }
            }
        }
        return result;
    }

    private formatToolDefs(tools: readonly ToolDefinition[]): JsonObject[] {
        return tools.map(tool => ({
            description: tool.description,
            name: tool.name,
            parameters: tool.prompt,
            strict: false,
            type: 'function',
        }));
    }

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.personalAccessToken) {
            headers.Authorization = `Bearer ${this.personalAccessToken}`;
        }
        return headers;
    }

    private async postJson(url: string, body: ProviderRequestBody, signal?: AbortSignal): Promise<Response> {
        const res = await fetch(url, {
            body: JSON.stringify(body),
            headers: this.buildHeaders(),
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
            const body = requireJsonObject(json, 'OpenAI error body');
            const error = requireJsonObject(body.error, 'OpenAI error');
            return Object.assign(new Error(optionalString(error.message) || `OpenAI API ${res.status}`), { status: res.status });
        } catch {
            return Object.assign(new Error(`OpenAI API ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
        }
    }

    private textContent(content: JsonValue | undefined, inputType = 'input_text'): JsonValue[] {
        const text = String(content ?? '');
        return text.length > 0 ? [{ text, type: inputType }] : [];
    }

    private readText(content: JsonValue | undefined): string {
        if (typeof content === 'string') return content;
        if (!Array.isArray(content)) return String(content ?? '');
        return content
            .map(part => isJsonObject(part) ? optionalString(part.text) : '')
            .join('');
    }

    private createActions(thinking: string, toolCalls: readonly ModelToolCall[]): ModelAction[] {
        return [
            ...(thinking.length > 0 ? [{ type: 'thinking' as const, content: thinking }] : []),
            ...toolCalls.map(call => ({ type: 'tool' as const, call })),
        ];
    }
}

function isJsonObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
