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

const DEFAULT_ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_ANTHROPIC_STREAM_ENDPOINT = DEFAULT_ANTHROPIC_ENDPOINT;
const CLAUDE_MAX_TOKENS = 4096;

interface ChatToolTracker {
    args: string;
    call?: ToolCall;
    finalized?: boolean;
    id: string;
    name: string;
}

export class ClaudeModel extends Model {
    constructor({ url = DEFAULT_ANTHROPIC_ENDPOINT, streamUrl = DEFAULT_ANTHROPIC_STREAM_ENDPOINT, ...rest }: ModelConfig = {}) {
        super({
            url: url || DEFAULT_ANTHROPIC_ENDPOINT,
            streamUrl: streamUrl || DEFAULT_ANTHROPIC_STREAM_ENDPOINT,
            ...rest,
        });
    }

    async *stream(request: ModelRequest): AsyncGenerator<ModelEvent, void, void> {
        const isChatCompletions = this.isChatCompletionsEndpoint();
        const body = this.buildRequestBody(request, isChatCompletions);
        const contentBlocks: JsonValue[] = [];
        const toolCalls: ToolCall[] = [];
        const toolArgs = new Map<number, { args: string; call: ToolCall }>();
        const chatToolTrackers = new Map<string, ChatToolTracker>();
        let content = '';
        let thinking = '';
        let thinkingStarted = false;
        let stopReason = '';

        for await (const chunk of this.requestStream(body, request.signal)) {
            const event = requireJsonObject(chunk, 'Claude stream event');
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
                        yield {
                            type: 'action',
                            action: { type: 'thinking', content: thinking },
                            kind: thinkingStarted ? 'update' : 'add',
                        };
                        thinkingStarted = true;
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
                        yield {
                            type: 'action',
                            action: { type: 'thinking', content: thinking },
                            kind: thinkingStarted ? 'update' : 'add',
                        };
                        thinkingStarted = true;
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
                    yield { type: 'action', action: { type: 'tool', call }, kind: 'add' };
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
                    thinking += requireString(delta.thinking, 'Claude thinking delta');
                    yield {
                        type: 'action',
                        action: { type: 'thinking', content: thinking },
                        kind: thinkingStarted ? 'update' : 'add',
                    };
                    thinkingStarted = true;
                    continue;
                }

                if (deltaType === 'input_json_delta') {
                    const tracker = toolArgs.get(index);
                    if (tracker !== undefined) {
                        tracker.args += requireString(delta.partial_json, 'Claude input JSON delta');
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
                    yield { type: 'action', action: { type: 'tool', call: tracker.call }, kind: 'update' };
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
            yield { type: 'action', action: { type: 'tool', call: tracker.call }, kind: 'update' };
        }

        const actions = this.createActions(thinking, toolCalls);
        yield {
            type: 'done',
            response: {
                actions,
                content,
                raw: this.createAssistantMsg(content, actions),
                status: toolCalls.length > 0
                    ? 'tool'
                    : stopReason === 'max_tokens'
                        ? 'continue'
                        : 'final',
            },
        };
    }

    protected async request(body: ProviderRequestBody, signal?: AbortSignal): Promise<ProviderResponseBody> {
        const res = await this.postJson(this.url || DEFAULT_ANTHROPIC_ENDPOINT, body, signal);
        return await res.json() as ProviderResponseBody;
    }

    protected async *requestStream(body: ProviderRequestBody, signal?: AbortSignal): AsyncGenerator<ProviderStreamChunk, void, void> {
        const res = await this.postJson(this.streamUrl || this.url || DEFAULT_ANTHROPIC_STREAM_ENDPOINT, body, signal);
        for await (const event of parseSseStream(res, { idleTimeout: 30000, signal })) {
            yield event;
        }
    }

    protected convertModelMessage2ProviderMessage(message: ModelMessage): ProviderMessage {
        return this.convertModelMessageToProviderMessages(message)[0] ?? { content: '', role: 'assistant' };
    }

    protected convertProviderMessage2ModelMessage(message: ProviderMessage): ModelMessage {
        const payload = requireJsonObject(message, 'Claude provider message');
        if (payload.role === 'tool') {
            return this.createToolResultMsg(requireString(payload.tool_call_id, 'Claude tool call id'), payload.content ?? '');
        }
        if (payload.role === 'user') {
            const content = Array.isArray(payload.content)
                ? payload.content.map(block => isJsonObject(block) ? optionalString(block.text, optionalString(block.content)) : '').join('')
                : optionalString(payload.content);
            return this.createUserMsg(content);
        }
        const parsed = this.parseAssistantPayload(payload);
        return this.createAssistantMsg(parsed.content, parsed.actions);
    }

    protected override convertModelMessages2ProviderMessages(messages: readonly ModelMessage[]): ProviderMessages {
        return messages.flatMap(message => this.convertModelMessageToProviderMessages(message));
    }

    createToolResultMsg(toolUseId: string, content: JsonValue): ModelMessage {
        return super.createToolResultMsg(toolUseId, content);
    }

    private buildRequestBody(request: ModelRequest, isChatCompletions: boolean): ProviderRequestBody {
        return isChatCompletions
            ? {
                max_tokens: CLAUDE_MAX_TOKENS,
                messages: this.toChatCompletionsMessages(request.messages, request.system ?? ''),
                model: this.model,
                ...(request.tools?.length ? { tools: this.toChatCompletionsTools(request.tools) } : {}),
                stream: true,
            }
            : {
                max_tokens: CLAUDE_MAX_TOKENS,
                messages: this.convertModelMessages2ProviderMessages(request.messages),
                model: this.model,
                ...(request.system ? { system: request.system } : {}),
                ...(request.tools?.length ? { tools: this.formatToolDefs(request.tools) } : {}),
                stream: true,
            };
    }

    private convertModelMessageToProviderMessages(message: ModelMessage): JsonObject[] {
        if (this.isChatCompletionsEndpoint()) {
            return this.convertModelMessageToChatCompletionsMessages(message);
        }

        if (message.role === 'user') {
            return [{ content: message.content, role: 'user' }];
        }

        if (message.role === 'tool') {
            return [{ content: [{ content: message.content, tool_use_id: message.toolUseId, type: 'tool_result' }], role: 'user' }];
        }

        const content: JsonValue[] = [];
        if (message.content.length > 0) {
            content.push({ text: message.content, type: 'text' });
        }
        for (const action of message.actions ?? []) {
            if (action.type === 'thinking' && action.content.length > 0) {
                content.push({ thinking: action.content, type: 'thinking' });
            }
            if (action.type === 'tool') {
                content.push({
                    id: action.call.id,
                    input: action.call.input,
                    name: action.call.name,
                    type: 'tool_use',
                });
            }
        }

        return content.length > 0 ? [{ content, role: 'assistant' }] : [];
    }

    private convertModelMessageToChatCompletionsMessages(message: ModelMessage): JsonObject[] {
        if (message.role === 'user') {
            return [{ content: message.content, role: 'user' }];
        }
        if (message.role === 'tool') {
            return [{ content: this.stringifyToolContent(message.content), role: 'tool', tool_call_id: message.toolUseId }];
        }
        const toolCalls = (message.actions ?? [])
            .filter((action): action is Extract<ModelAction, { type: 'tool' }> => action.type === 'tool')
            .map(action => ({
                function: {
                    arguments: JSON.stringify(action.call.input ?? {}),
                    name: action.call.name,
                },
                id: action.call.id,
                type: 'function',
            }));
        return [{
            content: toolCalls.length > 0 ? null : message.content,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            role: 'assistant',
        }];
    }

    private parseAssistantPayload(payload: JsonObject): { actions: ModelAction[]; content: string } {
        if (Array.isArray(payload.tool_calls)) {
            const actions = payload.tool_calls.map(value => {
                const tool = requireJsonObject(value, 'Claude chat tool call');
                const fn = requireJsonObject(tool.function, 'Claude chat tool function');
                const call: ToolCall = {
                    id: requireString(tool.id, 'Claude chat tool id'),
                    input: safeParseJsonObject(optionalString(fn.arguments)),
                    name: requireString(fn.name, 'Claude chat tool name'),
                };
                return { type: 'tool' as const, call };
            });
            return { actions, content: optionalString(payload.content) };
        }

        if (!Array.isArray(payload.content)) {
            return { actions: [], content: optionalString(payload.content) };
        }

        let content = '';
        const actions: ModelAction[] = [];
        for (const blockValue of payload.content) {
            const block = requireJsonObject(blockValue, 'Claude content block');
            if (block.type === 'text') {
                content += optionalString(block.text);
            }
            if (block.type === 'thinking') {
                const thinking = optionalString(block.thinking, optionalString(block.text));
                if (thinking.length > 0) actions.push({ type: 'thinking', content: thinking });
            }
            if (block.type === 'tool_use') {
                actions.push({
                    type: 'tool',
                    call: {
                        id: requireString(block.id, 'Claude tool use id'),
                        input: isJsonObject(block.input) ? block.input : {},
                        name: requireString(block.name, 'Claude tool use name'),
                    },
                });
            }
        }
        return { actions, content };
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
            void tracker.call;
        }

        return tracker;
    }

    private isChatCompletionsEndpoint(): boolean {
        return /\/chat\/completions(?:[?#]|$)/.test(this.url);
    }

    private formatToolDefs(tools: readonly ToolDefinition[]): JsonObject[] {
        return tools.map(tool => ({
            description: tool.description,
            input_schema: tool.input_schema,
            name: tool.name,
        }));
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
        result.push(...messages.flatMap(message => this.convertModelMessageToChatCompletionsMessages(message)));
        return result;
    }

    private createActions(thinking: string, toolCalls: readonly ToolCall[]): ModelAction[] {
        return [
            ...(thinking.length > 0 ? [{ type: 'thinking' as const, content: thinking }] : []),
            ...toolCalls.map(call => ({ type: 'tool' as const, call })),
        ];
    }

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.personalAccessToken) {
            headers['x-api-key'] = this.personalAccessToken;
            headers['anthropic-version'] = '2023-06-01';
            headers['anthropic-dangerous-direct-browser-access'] = 'true';
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
            const body = requireJsonObject(json, 'Claude error body');
            const error = requireJsonObject(body.error, 'Claude error');
            return Object.assign(new Error(optionalString(error.message) || `Claude API ${res.status}`), { status: res.status });
        } catch {
            return Object.assign(new Error(`Claude API ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
        }
    }

    private stringifyToolContent(content: JsonValue | undefined): string {
        if (typeof content === 'string') return content;
        try {
            return JSON.stringify(content);
        } catch {
            return String(content ?? '');
        }
    }
}

function isJsonObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
