import { Model, type ModelConfig, type ModelEvent, type ModelMessage, type ModelRequest, type ToolCall } from './Model';
import type { JsonObject, JsonValue, ToolDefinition } from '../tools/Tool';
import { optionalArray, optionalString, requireJsonObject, requireString, safeParseJsonObject } from '../utils/json';
import { parseSseStream } from '../utils/sse';

const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_STREAM_ENDPOINT = DEFAULT_OPENAI_ENDPOINT;

type OpenAIMessage = ModelMessage<JsonObject>;

export class OpenAIModel extends Model {
    constructor({ url = DEFAULT_OPENAI_ENDPOINT, streamUrl = DEFAULT_OPENAI_STREAM_ENDPOINT, ...rest }: ModelConfig = {}) {
        super({
            url: url || DEFAULT_OPENAI_ENDPOINT,
            streamUrl: streamUrl || DEFAULT_OPENAI_STREAM_ENDPOINT,
            ...rest,
        });
    }

    async *stream(request: ModelRequest): AsyncGenerator<ModelEvent, void, void> {
        const body = {
            input: this.toResponsesInput(request.messages),
            model: this.model,
            ...(request.system ? { instructions: request.system } : {}),
            ...(request.tools?.length ? { tools: this.toResponsesTools(request.tools) } : {}),
            stream: true,
        };

        const res = await this.fetchWithRetry(body, request.signal);
        const output: JsonValue[] = [];
        const toolCalls: ToolCall[] = [];
        const toolArgs = new Map<string, string>();
        const toolByItemId = new Map<string, ToolCall>();
        let finalStatus = '';
        let outputText = '';

        for await (const event of parseSseStream(res, { idleTimeout: 30000, signal: request.signal })) {
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

                yield { type: 'tool_call_start', callId, name };
                continue;
            }

            if (type === 'response.output_text.delta') {
                yield {
                    type: 'content_delta',
                    content: requireString(event.delta, 'OpenAI output text delta'),
                };
                continue;
            }

            if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
                yield {
                    type: 'thinking_delta',
                    content: requireString(event.delta, 'OpenAI reasoning delta'),
                };
                continue;
            }

            if (type === 'response.function_call_arguments.delta') {
                const itemId = requireString(event.item_id, 'OpenAI function call item_id');
                const delta = requireString(event.delta, 'OpenAI function call arguments delta');
                toolArgs.set(itemId, (toolArgs.get(itemId) ?? '') + delta);
                const call = toolByItemId.get(itemId);
                if (call !== undefined) {
                    yield { type: 'tool_call_delta', callId: call.id, inputDelta: delta };
                }
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
                        yield { type: 'tool_call_done', call };
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

        if (outputText.length > 0 && output.length === 0) {
            yield { type: 'content_delta', content: outputText };
        }

        yield {
            type: 'done',
            response: {
                content: outputText,
                raw: this.createAssistantMsg(output),
                status: toolCalls.length > 0
                    ? 'tool'
                    : finalStatus === 'incomplete'
                        ? 'continue'
                        : 'final',
                toolCalls,
            },
        };
    }

    toApiMessages(messages: readonly ModelMessage[]): ModelMessage[] {
        return messages.filter(message => message.provider === 'openai');
    }

    createToolResultMsg(toolUseId: string, content: JsonValue): OpenAIMessage {
        return this.wrap({ call_id: toolUseId, output: content, type: 'function_call_output' });
    }

    createUserMsg(content: string): OpenAIMessage {
        return this.wrap({ content, role: 'user' });
    }

    createAssistantTextMsg(content: string): OpenAIMessage {
        return this.wrap({ content, role: 'assistant' });
    }

    override formatToolDefs(tools: ToolDefinition[]): JsonObject[] {
        return this.toResponsesTools(tools);
    }

    override isSafeCompactBoundary(previous: ModelMessage, current: ModelMessage): boolean {
        if (previous.provider === 'openai') {
            const payload = requireJsonObject(previous.payload, 'OpenAI previous payload');
            if (payload.type === 'function_call') return false;
        }
        if (current.provider === 'openai') {
            const payload = requireJsonObject(current.payload, 'OpenAI current payload');
            if (payload.type === 'function_call_output') return false;
        }
        return true;
    }

    private toResponsesInput(messages: readonly ModelMessage[]): JsonValue[] {
        const result: JsonValue[] = [];

        for (const message of this.toApiMessages(messages)) {
            const msg = requireJsonObject(message.payload, 'OpenAI message payload');
            if (msg.type === 'function_call_output') {
                result.push(msg);
                continue;
            }
            if (msg.role === 'user') {
                result.push({ content: this.textContent(msg.content), role: 'user' });
                continue;
            }
            if (msg.role === 'assistant') {
                result.push({ content: this.textContent(msg.content, 'output_text'), role: 'assistant' });
                continue;
            }
            if (typeof msg.type === 'string') {
                result.push(msg);
            }
        }

        return result;
    }

    private toResponsesTools(tools: readonly ToolDefinition[]): JsonObject[] {
        return tools.map(tool => ({
            description: tool.description,
            name: tool.name,
            parameters: tool.input_schema,
            strict: false,
            type: 'function',
        }));
    }

    protected override buildUrl(): string {
        return this.streamUrl || this.url || DEFAULT_OPENAI_STREAM_ENDPOINT;
    }

    protected override buildHeaders(): Record<string, string> {
        const headers = super.buildHeaders();
        if (this.personalAccessToken) {
            headers['Authorization'] = `Bearer ${this.personalAccessToken}`;
        }
        return headers;
    }

    private textContent(content: JsonValue | undefined, inputType = 'input_text'): JsonValue[] {
        const text = String(content ?? '');
        return text.length > 0 ? [{ text, type: inputType }] : [];
    }

    private createAssistantMsg(rawContent: JsonValue): OpenAIMessage {
        if (Array.isArray(rawContent)) {
            return this.wrap({ content: rawContent, role: 'assistant' });
        }
        return this.wrap({
            content: rawContent ? this.textContent(rawContent, 'output_text') : [],
            role: 'assistant',
        });
    }

    private wrap(payload: JsonObject): OpenAIMessage {
        return { payload, provider: 'openai' };
    }
}
