import {
    Model,
    type ModelAction,
    type ModelConfig,
    type ModelEvent,
    type ModelMessage,
    type ModelRequest,
    type ProviderMessage,
    type ProviderMessages,
    type ProviderRequestBody,
    type ProviderResponseBody,
    type ProviderStreamChunk,
    type ToolCall,
} from './Model';
import type { JsonObject, JsonValue, ToolDefinition } from '../tools/Tool';
import { optionalArray, optionalString, requireJsonObject, requireString, safeParseJsonObject } from '../utils/json';
import { parseSseStream } from '../utils/sse';

const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_STREAM_ENDPOINT = DEFAULT_OPENAI_ENDPOINT;

export class OpenAIModel extends Model {
    constructor({ url = DEFAULT_OPENAI_ENDPOINT, streamUrl = DEFAULT_OPENAI_STREAM_ENDPOINT, ...rest }: ModelConfig = {}) {
        super({
            url: url || DEFAULT_OPENAI_ENDPOINT,
            streamUrl: streamUrl || DEFAULT_OPENAI_STREAM_ENDPOINT,
            ...rest,
        });
    }

    async *stream(request: ModelRequest): AsyncGenerator<ModelEvent, void, void> {
        const body: ProviderRequestBody = {
            input: this.convertModelMessages2ProviderMessages(request.messages),
            model: this.model,
            ...(request.system ? { instructions: request.system } : {}),
            ...(request.tools?.length ? { tools: this.formatToolDefs(request.tools) } : {}),
            stream: true,
        };

        const output: JsonValue[] = [];
        const toolCalls: ToolCall[] = [];
        const toolArgs = new Map<string, string>();
        const toolByItemId = new Map<string, ToolCall>();
        let finalStatus = '';
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
                const call: ToolCall = { id: callId, input: {}, name };

                toolByItemId.set(itemId, call);
                toolArgs.set(itemId, optionalString(item.arguments));
                toolCalls.push(call);

                yield { type: 'action', action: { type: 'tool', call }, kind: 'add' };
                continue;
            }

            if (type === 'response.output_text.delta') {
                const delta = requireString(event.delta, 'OpenAI output text delta');
                content += delta;
                yield { type: 'content_delta', content: delta };
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
                const response = requireJsonObject(event.response, 'OpenAI response');
                finalStatus = requireString(response.status, 'OpenAI response status');
                outputText = optionalString(response.output_text);
                if (output.length === 0) {
                    output.push(...optionalArray(response.output));
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
            yield { type: 'content_delta', content: finalContent };
        }

        const actions = this.createActions(thinking, toolCalls);
        yield {
            type: 'done',
            response: {
                actions,
                content: finalContent,
                raw: this.createAssistantMsg(finalContent, actions),
                status: toolCalls.length > 0
                    ? 'tool'
                    : finalStatus === 'incomplete'
                        ? 'continue'
                        : 'final',
            },
        };
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

    protected convertModelMessage2ProviderMessage(message: ModelMessage): ProviderMessage {
        return this.convertModelMessageToProviderMessages(message)[0] ?? { content: [], role: 'assistant' };
    }

    protected convertProviderMessage2ModelMessage(message: ProviderMessage): ModelMessage {
        const payload = requireJsonObject(message, 'OpenAI provider message');
        if (payload.type === 'function_call_output') {
            return this.createToolResultMsg(requireString(payload.call_id, 'OpenAI tool result id'), payload.output ?? '');
        }
        if (payload.type === 'function_call') {
            const call: ToolCall = {
                id: requireString(payload.call_id, 'OpenAI function call id'),
                input: safeParseJsonObject(optionalString(payload.arguments)),
                name: requireString(payload.name, 'OpenAI function call name'),
            };
            return this.createAssistantMsg('', [{ type: 'tool', call }]);
        }
        if (payload.role === 'user') {
            return this.createUserMsg(this.readText(payload.content));
        }
        return this.createAssistantMsg(this.readText(payload.content));
    }

    protected override convertModelMessages2ProviderMessages(messages: readonly ModelMessage[]): ProviderMessages {
        return messages.flatMap(message => this.convertModelMessageToProviderMessages(message));
    }

    private convertModelMessageToProviderMessages(message: ModelMessage): JsonObject[] {
        if (message.role === 'user') {
            return [{ content: this.textContent(message.content), role: 'user' }];
        }

        if (message.role === 'tool') {
            return [{ call_id: message.toolUseId, output: message.content, type: 'function_call_output' }];
        }

        const result: JsonObject[] = [];
        if (message.content.length > 0) {
            result.push({ content: this.textContent(message.content, 'output_text'), role: 'assistant' });
        }

        for (const action of message.actions ?? []) {
            if (action.type !== 'tool') continue;
            result.push({
                arguments: JSON.stringify(action.call.input ?? {}),
                call_id: action.call.id,
                name: action.call.name,
                type: 'function_call',
            });
        }

        return result;
    }

    private formatToolDefs(tools: readonly ToolDefinition[]): JsonObject[] {
        return tools.map(tool => ({
            description: tool.description,
            name: tool.name,
            parameters: tool.input_schema,
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

    private createActions(thinking: string, toolCalls: readonly ToolCall[]): ModelAction[] {
        return [
            ...(thinking.length > 0 ? [{ type: 'thinking' as const, content: thinking }] : []),
            ...toolCalls.map(call => ({ type: 'tool' as const, call })),
        ];
    }
}

function isJsonObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
