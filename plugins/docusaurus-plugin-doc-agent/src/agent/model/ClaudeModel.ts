import { Model, type ModelConfig, type ModelEvent, type ModelMessage, type ModelRequest, type ToolCall } from './Model';
import type { JsonObject, JsonValue, ToolDefinition } from '../tools/Tool';
import { optionalArray, optionalString, requireJsonObject, requireString, safeParseJsonObject } from '../utils/json';
import { parseSseStream } from '../utils/sse';

const DEFAULT_ANTHROPIC_ENDPOINT = '/agent/v1/messages';
const CLAUDE_MAX_TOKENS = 4096;

type ClaudeMessage = ModelMessage<JsonObject>;

interface ChatToolTracker {
    args: string;
    call?: ToolCall;
    finalized?: boolean;
    id: string;
    name: string;
}

export class ClaudeModel extends Model {
    constructor({ endpoint = DEFAULT_ANTHROPIC_ENDPOINT, ...rest }: ModelConfig = {}) {
        super({ endpoint: endpoint || DEFAULT_ANTHROPIC_ENDPOINT, ...rest });
    }

    async *stream(request: ModelRequest): AsyncGenerator<ModelEvent, void, void> {
        const isChatCompletions = this.isChatCompletionsEndpoint();
        const body = isChatCompletions
            ? {
                max_tokens: CLAUDE_MAX_TOKENS,
                messages: this.toChatCompletionsMessages(request.messages, request.system ?? ''),
                model: this.model,
                ...(request.tools?.length ? { tools: this.toChatCompletionsTools(request.tools) } : {}),
                stream: true,
            }
            : {
                max_tokens: CLAUDE_MAX_TOKENS,
                messages: this.toApiMessages(request.messages).map(message => message.payload),
                model: this.model,
                ...(request.system ? { system: request.system } : {}),
                ...(request.tools?.length ? { tools: this.formatToolDefs(request.tools) } : {}),
                stream: true,
            };

        const res = await this.fetchWithRetry(body, request.signal);
        const contentBlocks: JsonValue[] = [];
        const toolCalls: ToolCall[] = [];
        const toolArgs = new Map<number, { args: string; call: ToolCall }>();
        const chatToolTrackers = new Map<string, ChatToolTracker>();
        let content = '';
        let thinking = '';
        let stopReason = '';

        for await (const event of parseSseStream(res, { idleTimeout: 30000, signal: request.signal })) {
            const eventType = requireString(event.type, 'Claude stream event type');

            if (eventType === 'error') {
                const error = requireJsonObject(event.error, 'Claude stream error');
                yield { type: 'error', error: new Error(optionalString(error.message) || 'Claude stream failed') };
                return;
            }

            const choices = optionalArray(event.choices);
            if (event.object === 'chat.completion.chunk' || choices.length > 0) {
                for (const item of choices) {
                    const choice = requireJsonObject(item, 'Claude chat completion choice');
                    const choiceIndex = Number(choice.index ?? 0);
                    const delta = requireJsonObject(choice.delta, 'Claude chat completion delta');
                    const reasoningContent = optionalString(delta.reasoning_content, optionalString(delta.reasoning));
                    const textContent = optionalString(delta.content);

                    if (reasoningContent.length > 0) {
                        thinking += reasoningContent;
                        yield { type: 'thinking_delta', content: reasoningContent };
                    }

                    if (textContent.length > 0) {
                        content += textContent;
                        yield { type: 'content_delta', content: textContent };
                    }

                    for (const toolCallDelta of optionalArray(delta.tool_calls)) {
                        const toolDelta = requireJsonObject(toolCallDelta, 'Claude chat completion tool delta');
                        const toolIndex = Number(toolDelta.index ?? 0);
                        const tracker = this.ensureChatToolTracker(`${choiceIndex}:${toolIndex}`, toolDelta, toolCalls, chatToolTrackers);
                        const fn = isJsonObject(toolDelta.function) ? toolDelta.function : {};
                        tracker.args += optionalString(fn.arguments);
                        if (tracker.call !== undefined && optionalString(fn.arguments).length > 0) {
                            yield {
                                type: 'tool_call_delta',
                                callId: tracker.call.id,
                                inputDelta: optionalString(fn.arguments),
                            };
                        }
                    }

                    const finishReason = optionalString(choice.finish_reason);
                    if (finishReason === 'length') {
                        stopReason = 'max_tokens';
                    } else if (finishReason.length > 0) {
                        stopReason = finishReason;
                    }
                }
                continue;
            }

            if (eventType === 'content_block_start') {
                const index = Number(event.index ?? contentBlocks.length);
                const block = requireJsonObject(event.content_block, 'Claude content block');
                const type = requireString(block.type, 'Claude content block type');

                if (type === 'text') {
                    contentBlocks[index] = { text: '', type: 'text' };
                    const text = optionalString(block.text);
                    if (text.length > 0) {
                        content += text;
                        yield { type: 'content_delta', content: text };
                    }
                    continue;
                }

                if (type === 'thinking') {
                    contentBlocks[index] = { text: '', type: 'thinking' };
                    const text = optionalString(block.thinking);
                    if (text.length > 0) {
                        thinking += text;
                        yield { type: 'thinking_delta', content: text };
                    }
                    continue;
                }

                if (type === 'tool_use') {
                    const call: ToolCall = {
                        id: requireString(block.id, 'Claude tool_use id'),
                        input: isJsonObject(block.input) ? block.input : {},
                        name: requireString(block.name, 'Claude tool_use name'),
                    };
                    toolCalls.push(call);
                    contentBlocks[index] = {
                        id: call.id,
                        input: call.input,
                        name: call.name,
                        type: 'tool_use',
                    };
                    toolArgs.set(index, { args: '', call });
                    yield { type: 'tool_call_start', callId: call.id, name: call.name };
                }
                continue;
            }

            if (eventType === 'content_block_delta') {
                const index = Number(event.index ?? 0);
                const delta = requireJsonObject(event.delta, 'Claude content block delta');
                const deltaType = requireString(delta.type, 'Claude content block delta type');

                if (deltaType === 'text_delta') {
                    const text = requireString(delta.text, 'Claude text delta');
                    content += text;
                    yield { type: 'content_delta', content: text };
                    continue;
                }

                if (deltaType === 'thinking_delta') {
                    const text = requireString(delta.thinking, 'Claude thinking delta');
                    thinking += text;
                    yield { type: 'thinking_delta', content: text };
                    continue;
                }

                if (deltaType === 'input_json_delta') {
                    const tracker = toolArgs.get(index);
                    if (tracker !== undefined) {
                        const partial = requireString(delta.partial_json, 'Claude input JSON delta');
                        tracker.args += partial;
                        yield { type: 'tool_call_delta', callId: tracker.call.id, inputDelta: partial };
                    }
                }
                continue;
            }

            if (eventType === 'content_block_stop') {
                const index = Number(event.index ?? 0);
                const tracker = toolArgs.get(index);
                if (tracker !== undefined) {
                    if (tracker.args.length > 0) {
                        tracker.call.input = safeParseJsonObject(tracker.args);
                    }
                    yield { type: 'tool_call_done', call: tracker.call };
                }
                continue;
            }

            if (eventType === 'message_delta') {
                const delta = requireJsonObject(event.delta, 'Claude message delta');
                stopReason = optionalString(delta.stop_reason, stopReason);
                continue;
            }

            if (eventType === 'message_stop') {
                break;
            }
        }

        for (const tracker of chatToolTrackers.values()) {
            if (tracker.finalized || tracker.call === undefined) continue;
            tracker.call.input = safeParseJsonObject(tracker.args);
            tracker.finalized = true;
            yield { type: 'tool_call_done', call: tracker.call };
        }

        yield {
            type: 'done',
            response: {
                content,
                raw: isChatCompletions
                    ? this.createChatCompletionsAssistantMsg(content, chatToolTrackers)
                    : this.createAssistantMsg(contentBlocks.filter(Boolean)),
                status: toolCalls.length > 0
                    ? 'tool'
                    : stopReason === 'max_tokens'
                        ? 'continue'
                        : 'final',
                thinking: thinking || undefined,
                toolCalls,
            },
        };
    }

    toApiMessages(messages: readonly ModelMessage[]): ModelMessage[] {
        return messages.filter(message => message.provider === 'anthropic');
    }

    createToolResultMsg(toolUseId: string, content: JsonValue): ClaudeMessage {
        if (this.isChatCompletionsEndpoint()) {
            return this.wrap({ content: this.stringifyToolContent(content), role: 'tool', tool_call_id: toolUseId });
        }
        return this.wrap({ content: [{ content, tool_use_id: toolUseId, type: 'tool_result' }], role: 'user' });
    }

    createUserMsg(content: string): ClaudeMessage {
        return this.wrap({ content, role: 'user' });
    }

    createAssistantTextMsg(content: string): ClaudeMessage {
        return this.wrap({ content, role: 'assistant' });
    }

    override formatToolDefs(tools: ToolDefinition[]): JsonObject[] {
        if (this.isChatCompletionsEndpoint()) {
            return this.toChatCompletionsTools(tools);
        }
        return tools.map(tool => ({
            description: tool.description,
            input_schema: tool.input_schema,
            name: tool.name,
        }));
    }

    override isSafeCompactBoundary(previous: ModelMessage, current: ModelMessage): boolean {
        if (previous.provider === 'anthropic') {
            const payload = requireJsonObject(previous.payload, 'Claude previous payload');
            if (Array.isArray(payload.tool_calls)) return false;
            if (Array.isArray(payload.content) && payload.content.some(block => isJsonObject(block) && block.type === 'tool_use')) {
                return false;
            }
        }
        if (current.provider === 'anthropic') {
            const payload = requireJsonObject(current.payload, 'Claude current payload');
            if (payload.role === 'tool') return false;
            if (Array.isArray(payload.content) && payload.content.some(block => isJsonObject(block) && block.type === 'tool_result')) {
                return false;
            }
        }
        return true;
    }

    private ensureChatToolTracker(
        key: string,
        toolDelta: JsonObject,
        toolCalls: ToolCall[],
        chatTrackers: Map<string, ChatToolTracker>,
    ): ChatToolTracker {
        const fn = isJsonObject(toolDelta.function) ? toolDelta.function : {};
        let tracker = chatTrackers.get(key);
        const id = optionalString(toolDelta.id, tracker?.id || '');
        const name = optionalString(fn.name, tracker?.name || '');

        if (tracker === undefined) {
            tracker = { args: '', id, name };
            chatTrackers.set(key, tracker);
        } else {
            tracker.id = id;
            tracker.name = name;
        }

        if (tracker.call === undefined && tracker.id.length > 0 && tracker.name.length > 0) {
            tracker.call = { id: tracker.id, input: {}, name: tracker.name };
            toolCalls.push(tracker.call);
        }

        return tracker;
    }

    private isChatCompletionsEndpoint(): boolean {
        return /\/chat\/completions(?:[?#]|$)/.test(this.endpoint);
    }

    private toChatCompletionsTools(tools: readonly ToolDefinition[]): JsonObject[] {
        return tools.map(tool => ({
            function: {
                description: tool.description,
                name: tool.name,
                parameters: tool.input_schema,
            },
            type: 'function',
        }));
    }

    private toChatCompletionsMessages(messages: readonly ModelMessage[], system: string): JsonValue[] {
        const result: JsonValue[] = [];
        if (system.length > 0) {
            result.push({ content: system, role: 'system' });
        }

        for (const message of this.toApiMessages(messages)) {
            const msg = requireJsonObject(message.payload, 'Claude message payload');
            if (msg.role === 'tool') {
                result.push(msg);
                continue;
            }
            if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
                result.push({
                    content: this.stringifyToolContent(msg.content),
                    role: msg.role,
                });
            }
        }

        return result;
    }

    private createAssistantMsg(rawContent: JsonValue): ClaudeMessage {
        const content = Array.isArray(rawContent) ? rawContent : [];
        return this.wrap({ content, role: 'assistant' });
    }

    private createChatCompletionsAssistantMsg(content: string, trackers: Map<string, ChatToolTracker>): ClaudeMessage {
        const toolCalls = Array.from(trackers.values())
            .filter(tracker => tracker.id.length > 0 && tracker.name.length > 0)
            .map(tracker => ({
                function: {
                    arguments: tracker.args,
                    name: tracker.name,
                },
                id: tracker.id,
                type: 'function',
            }));

        return this.wrap({
            content: toolCalls.length > 0 ? null : content,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            role: 'assistant',
        });
    }

    private stringifyToolContent(content: JsonValue | undefined): string {
        if (typeof content === 'string') return content;
        try {
            return JSON.stringify(content);
        } catch {
            return String(content ?? '');
        }
    }

    private wrap(payload: JsonObject): ClaudeMessage {
        return { payload, provider: 'anthropic' };
    }
}

function isJsonObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
