import { parseSseStream, safeParse } from '../utils/utils';
import { Adapter } from './Adapter';
import { Action } from '../round/Action';
import type {
    StreamActionCallback,
    AdapterChatResponse,
    AdapterMessage,
    AdapterMessageList,
    AdapterConfig,
    MessageList,
    RuntimeTool,
    ToolCall,
    ToolCallList,
    ToolDefinitionList,
    UnknownList,
    UnknownRecord,
} from '../types';

const DEFAULT_ANTHROPIC_ENDPOINT = '/agent/v1/messages';
const CLAUDE_MAX_TOKENS = 4096;

type ClaudeMessagePayload = UnknownRecord;
type ClaudeMessage = AdapterMessage<ClaudeMessagePayload>;
type ClaudeMessageList = ClaudeMessage[];
type ChatToolTracker = {
    action?: Action;
    args: string;
    finalized?: boolean;
    id: string;
    name: string;
};

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, context: string): UnknownRecord {
    if (isRecord(value)) return value;
    throw new Error(`${context} must be an object`);
}

function requireString(value: unknown, context: string): string {
    if (typeof value === 'string') return value;
    throw new Error(`${context} must be a string`);
}

function optionalString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function optionalList(value: unknown): UnknownList {
    return Array.isArray(value) ? value : [];
}

export class ClaudeAdapter extends Adapter {
    constructor({ endpoint = DEFAULT_ANTHROPIC_ENDPOINT, ...rest }: AdapterConfig = {}) {
        super({ endpoint: endpoint || DEFAULT_ANTHROPIC_ENDPOINT, ...rest });
    }

    async chat(messages: AdapterMessageList, toolDefs: ToolDefinitionList, system: string, signal?: AbortSignal, onStreamAction?: StreamActionCallback): Promise<AdapterChatResponse> {
        const isChatCompletions = this.isChatCompletionsEndpoint();
        const body = isChatCompletions
            ? {
                model: this.model,
                max_tokens: CLAUDE_MAX_TOKENS,
                messages: this.toChatCompletionsMessages(messages, system),
                stream: true,
                ...(toolDefs?.length ? { tools: this.toChatCompletionsTools(toolDefs) } : {}),
            }
            : {
                model: this.model,
                max_tokens: CLAUDE_MAX_TOKENS,
                system: system || '',
                messages: messages.map(message => message.payload),
                stream: true,
                ...(toolDefs?.length ? { tools: toolDefs } : {}),
            };

        const res = await this.fetchWithRetry(body, signal);
        const actions: Action[] = [];
        const toolCalls: ToolCallList = [];
        const contentBlocks: UnknownList = [];
        const textActions = new Map<number, Action>();
        const thinkingActions = new Map<number, Action>();
        const toolTrackers = new Map<number, { action: Action; args: string }>();
        const chatToolTrackers = new Map<string, ChatToolTracker>();
        let stopReason = '';

        const emit = (action: Action, kind: 'add' | 'update') => {
            if (onStreamAction) onStreamAction(action, kind);
        };

        const ensureTextBlock = (index: number, type: 'content' | 'thinking') => {
            const blockType = type === 'content' ? 'text' : 'thinking';
            const block = isRecord(contentBlocks[index]) ? contentBlocks[index] as UnknownRecord : {};
            if (block.type !== blockType) {
                contentBlocks[index] = { type: blockType, text: '' };
            }
        };

        const appendText = (index: number, delta: string, type: 'content' | 'thinking') => {
            if (!delta) return;
            const bucket = type === 'content' ? textActions : thinkingActions;
            let action = bucket.get(index);
            if (!action) {
                action = new Action({ type, content: '' });
                bucket.set(index, action);
                actions.push(action);
                emit(action, 'add');
            }
            action.content += delta;
            emit(action, 'update');

            const block = isRecord(contentBlocks[index]) ? contentBlocks[index] as UnknownRecord : {};
            if (block.type === 'text' || block.type === 'thinking') {
                block.text = optionalString(block.text) + delta;
            }
        };

        const ensureChatToolTracker = (key: string, toolDelta: UnknownRecord): ChatToolTracker | null => {
            const fn = isRecord(toolDelta.function) ? toolDelta.function : {};
            let tracker = chatToolTrackers.get(key);
            const id = optionalString(toolDelta.id, tracker?.id || '');
            const name = optionalString(fn.name, tracker?.name || '');

            if (!tracker) {
                tracker = { id, name, args: '' };
                chatToolTrackers.set(key, tracker);
            } else {
                tracker.id = id;
                tracker.name = name;
            }

            if (!tracker.action && tracker.id && tracker.name) {
                const call: ToolCall = { id: tracker.id, name: tracker.name, input: {} };
                tracker.action = new Action({ type: 'tool', call });
                toolCalls.push(call);
                actions.push(tracker.action);
                emit(tracker.action, 'add');
            }

            return tracker;
        };

        const finalizeChatToolTrackers = () => {
            for (const tracker of chatToolTrackers.values()) {
                if (tracker.finalized || !tracker.action?.call) continue;
                tracker.action.call.input = safeParse(tracker.args);
                tracker.finalized = true;
                emit(tracker.action, 'update');
            }
        };

        for await (const event of parseSseStream(res, { idleTimeout: 30000, signal })) {
            const eventType = requireString(event.type, 'Claude stream event type');

            if (eventType === 'error') {
                const error = requireRecord(event.error, 'Claude stream error');
                throw new Error(optionalString(error.message) || 'Claude stream failed');
            }

            const choices = optionalList(event.choices);
            if (event.object === 'chat.completion.chunk' || choices.length) {
                for (const item of choices) {
                    const choice = requireRecord(item, 'Claude chat completion choice');
                    const choiceIndex = Number(choice.index ?? 0);
                    const delta = requireRecord(choice.delta, 'Claude chat completion delta');
                    const reasoningContent = optionalString(delta.reasoning_content, optionalString(delta.reasoning));
                    const content = optionalString(delta.content);
                    const reasoningBlockIndex = choiceIndex * 2;
                    const contentBlockIndex = choiceIndex * 2 + 1;

                    if (reasoningContent) {
                        ensureTextBlock(reasoningBlockIndex, 'thinking');
                        appendText(reasoningBlockIndex, reasoningContent, 'thinking');
                    }

                    if (content) {
                        ensureTextBlock(contentBlockIndex, 'content');
                        appendText(contentBlockIndex, content, 'content');
                    }

                    for (const toolCallDelta of optionalList(delta.tool_calls)) {
                        const toolDelta = requireRecord(toolCallDelta, 'Claude chat completion tool delta');
                        const toolIndex = Number(toolDelta.index ?? 0);
                        const tracker = ensureChatToolTracker(`${choiceIndex}:${toolIndex}`, toolDelta);
                        if (tracker) {
                            const fn = isRecord(toolDelta.function) ? toolDelta.function : {};
                            tracker.args += optionalString(fn.arguments);
                        }
                    }

                    const finishReason = optionalString(choice.finish_reason);
                    if (finishReason === 'length') {
                        stopReason = 'max_tokens';
                    } else if (finishReason) {
                        stopReason = finishReason;
                        if (finishReason === 'tool_calls') finalizeChatToolTrackers();
                    }
                }
                continue;
            }

            if (eventType === 'content_block_start') {
                const index = Number(event.index ?? contentBlocks.length);
                const block = requireRecord(event.content_block, 'Claude content block');
                const type = requireString(block.type, 'Claude content block type');

                if (type === 'text') {
                    contentBlocks[index] = { type: 'text', text: '' };
                    appendText(index, optionalString(block.text), 'content');
                    continue;
                }

                if (type === 'thinking') {
                    contentBlocks[index] = { type: 'thinking', text: '' };
                    appendText(index, optionalString(block.thinking), 'thinking');
                    continue;
                }

                if (type === 'tool_use') {
                    const id = requireString(block.id, 'Claude tool_use id');
                    const name = requireString(block.name, 'Claude tool_use name');

                    const call = { id, name, input: isRecord(block.input) ? block.input : {} };
                    const action = new Action({ type: 'tool', call });
                    toolCalls.push(call);
                    actions.push(action);
                    contentBlocks[index] = { type: 'tool_use', id, name, input: call.input };
                    toolTrackers.set(index, { action, args: '' });
                    emit(action, 'add');
                }
                continue;
            }

            if (eventType === 'content_block_delta') {
                const index = Number(event.index ?? 0);
                const delta = requireRecord(event.delta, 'Claude content block delta');
                const deltaType = requireString(delta.type, 'Claude content block delta type');

                if (deltaType === 'text_delta') {
                    appendText(index, requireString(delta.text, 'Claude text delta'), 'content');
                    continue;
                }

                if (deltaType === 'thinking_delta') {
                    appendText(index, requireString(delta.thinking, 'Claude thinking delta'), 'thinking');
                    continue;
                }

                if (deltaType === 'input_json_delta') {
                    const tracker = toolTrackers.get(index);
                    if (tracker) tracker.args += requireString(delta.partial_json, 'Claude input JSON delta');
                }
                continue;
            }

            if (eventType === 'content_block_stop') {
                const index = Number(event.index ?? 0);
                const tracker = toolTrackers.get(index);
                if (tracker?.action.call && tracker.args) {
                    tracker.action.call.input = safeParse(tracker.args);
                    const block = isRecord(contentBlocks[index]) ? contentBlocks[index] as UnknownRecord : {};
                    block.input = tracker.action.call.input;
                    emit(tracker.action, 'update');
                }
                continue;
            }

            if (eventType === 'message_delta') {
                const delta = requireRecord(event.delta, 'Claude message delta');
                stopReason = optionalString(delta.stop_reason, stopReason);
                continue;
            }

            if (eventType === 'message_stop') break;
        }

        if (chatToolTrackers.size > 0) finalizeChatToolTrackers();

        const status = toolCalls.length
            ? 'tool'
            : stopReason === 'max_tokens'
                ? 'continue'
                : 'final';

        return {
            actions,
            raw: isChatCompletions
                ? this.createChatCompletionsAssistantMsg(contentBlocks.filter(Boolean), chatToolTrackers)
                : this.createAssistantMsg(contentBlocks.filter(Boolean)),
            status,
        };
    }

    formatToolDefs(tools: RuntimeTool[]): ToolDefinitionList {
        if (this.isChatCompletionsEndpoint()) return this.toChatCompletionsTools(tools) as ToolDefinitionList;
        return tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
        }));
    }

    createUserMsg(content: string): ClaudeMessage {
        return this.wrap({ role: 'user', content });
    }

    createAssistantTextMsg(content: string): ClaudeMessage {
        return this.wrap({ role: 'assistant', content });
    }

    createToolResultMsg(toolUseId: string, content: unknown): ClaudeMessage {
        if (this.isChatCompletionsEndpoint()) {
            return this.wrap({ role: 'tool', tool_call_id: toolUseId, content: this.stringifyToolContent(content) });
        }
        return this.wrap({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] });
    }

    toApiMessages(messages: MessageList): ClaudeMessageList {
        const result: ClaudeMessageList = [];
        const isChatCompletions = this.isChatCompletionsEndpoint();
        for (const msg of messages) {
            if (msg.local) continue;
            if (msg.role === 'user') {
                result.push(this.createUserMsg(msg.content));
            } else if (msg.role === 'assistant') {
                const plans = msg.plans || [];
                if (!plans.length) {
                    if (msg.content) result.push(this.wrap({ role: 'assistant', content: msg.content }));
                } else {
                    for (const plan of plans) {
                        for (const round of plan.rounds || []) {
                            const content: UnknownList = [];
                            const toolResults: UnknownList = [];
                            for (const action of round.actions || []) {
                                if (action.type === 'content' && action.content) {
                                    content.push({ type: 'text', text: action.content });
                                } else if (action.type === 'tool' && action.call) {
                                    const tc = action.call;
                                    if (isChatCompletions && !('result' in tc)) continue;
                                    if (isChatCompletions) {
                                        result.push(this.wrap({
                                            role: 'user',
                                            content: this.formatToolHistoryText(tc),
                                        }));
                                        continue;
                                    }
                                    content.push({
                                        type: 'tool_use',
                                        id: tc.id,
                                        name: tc.name,
                                        input: tc.input,
                                    });
                                    if ('result' in tc) {
                                        toolResults.push({
                                            type: 'tool_result',
                                            tool_use_id: tc.id,
                                            content: tc.result,
                                        });
                                    }
                                }
                            }
                            if (!content.length) continue;
                            result.push(this.wrap({
                                role: 'assistant',
                                content,
                            }));
                            if (toolResults.length) {
                                result.push(this.wrap({
                                    role: 'user',
                                    content: toolResults,
                                }));
                            }
                        }
                    }
                    if (msg.content) {
                        result.push(this.wrap({ role: 'assistant', content: msg.content }));
                    }
                }
            }
        }
        return result;
    }

    protected buildStreamBody(messages: AdapterMessageList, system: string): unknown {
        return {
            model: this.model,
            max_tokens: CLAUDE_MAX_TOKENS,
            system: system || '',
            messages: messages.map(message => message.payload),
            stream: true,
        };
    }

    protected parseStreamEvent(json: UnknownRecord): string | null | undefined {
        if (json.type === 'content_block_delta') {
            const delta = requireRecord(json.delta, 'Claude content block delta');
            if (delta.type === 'text_delta' && delta.text) {
                return requireString(delta.text, 'Claude text delta');
            }
        } else if (json.type === 'message_stop') {
            return null;
        }
        return undefined;
    }

    protected override isToolCallMessage(message: AdapterMessage): boolean {
        if (message.provider !== 'anthropic') return false;
        const payload = requireRecord(message.payload, 'Claude message payload');
        if (Array.isArray(payload.tool_calls)) return true;
        const content = payload.content;
        return Array.isArray(content) && content.some(block => isRecord(block) && block.type === 'tool_use');
    }

    protected override isToolResultMessage(message: AdapterMessage): boolean {
        if (message.provider !== 'anthropic') return false;
        const payload = requireRecord(message.payload, 'Claude message payload');
        if (payload.role === 'tool') return true;
        const content = payload.content;
        return Array.isArray(content) && content.some(block => isRecord(block) && block.type === 'tool_result');
    }

    private isChatCompletionsEndpoint(): boolean {
        return /\/chat\/completions(?:[?#]|$)/.test(this.endpoint);
    }

    private stringifyToolContent(content: unknown): string {
        if (typeof content === 'string') return content;
        try {
            return JSON.stringify(content);
        } catch {
            return String(content ?? '');
        }
    }

    private toChatCompletionsTools(tools: unknown[]): UnknownList {
        return tools.map(tool => {
            const item = requireRecord(tool, 'Claude chat completion tool');
            const fn = isRecord(item.function) ? item.function : {};
            const parameters = isRecord(fn.parameters)
                ? fn.parameters
                : isRecord(item.input_schema)
                    ? item.input_schema
                    : {};
            return {
                type: 'function',
                function: {
                    name: optionalString(fn.name, optionalString(item.name)),
                    description: optionalString(fn.description, optionalString(item.description)),
                    parameters,
                },
            };
        });
    }

    private toChatCompletionsMessages(messages: AdapterMessageList, system: string): UnknownList {
        const result: UnknownList = [];
        if (system) result.push({ role: 'system', content: system });

        for (const message of messages) {
            const msg = requireRecord(message.payload, 'Claude message payload');

            if (msg.role === 'tool') {
                result.push({
                    role: 'tool',
                    tool_call_id: requireString(msg.tool_call_id, 'Claude tool result id'),
                    content: this.stringifyToolContent(msg.content),
                });
                continue;
            }

            if (Array.isArray(msg.tool_calls)) {
                result.push({
                    role: 'assistant',
                    content: msg.tool_calls.length ? null : optionalString(msg.content),
                    tool_calls: msg.tool_calls,
                });
                continue;
            }

            if (msg.role === 'user' && Array.isArray(msg.content)) {
                for (const block of msg.content) {
                    const item = requireRecord(block, 'Claude user content block');
                    if (item.type !== 'tool_result') continue;
                    result.push({
                        role: 'tool',
                        tool_call_id: requireString(item.tool_use_id, 'Claude tool result id'),
                        content: this.stringifyToolContent(item.content),
                    });
                }
                continue;
            }

            if (msg.role === 'assistant' && Array.isArray(msg.content)) {
                const content = msg.content
                    .map(block => requireRecord(block, 'Claude assistant content block'))
                    .filter(block => block.type === 'text')
                    .map(block => requireString(block.text, 'Claude text block text'))
                    .join('');
                const toolCalls = msg.content
                    .map(block => requireRecord(block, 'Claude assistant content block'))
                    .filter(block => block.type === 'tool_use')
                    .map(block => ({
                        id: requireString(block.id, 'Claude tool_use id'),
                        type: 'function',
                        function: {
                            name: requireString(block.name, 'Claude tool_use name'),
                            arguments: JSON.stringify(isRecord(block.input) ? block.input : {}),
                        },
                    }));

                result.push({
                    role: 'assistant',
                    content: toolCalls.length ? (content || null) : content,
                    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
                });
                continue;
            }

            if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
                result.push({ role: msg.role, content: this.stringifyChatContent(msg.content) });
            }
        }

        return result;
    }

    private stringifyChatContent(content: unknown): string {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content
                .map(block => {
                    if (!isRecord(block)) return '';
                    if (block.type === 'text') return optionalString(block.text);
                    return '';
                })
                .join('');
        }
        return this.stringifyToolContent(content);
    }

    private formatToolHistoryText(call: ToolCall): string {
        return [
            '[Tool call]',
            `${call.name}(${this.stringifyToolContent(call.input || {})})`,
            '',
            '[Tool result]',
            this.stringifyToolContent(call.result),
        ].join('\n');
    }

    private createChatCompletionsAssistantMsg(rawContent: UnknownList, chatToolTrackers: Map<string, ChatToolTracker>): ClaudeMessage {
        const content = rawContent
            .map(block => requireRecord(block, 'Claude content block'))
            .filter(block => block.type === 'text')
            .map(block => requireString(block.text, 'Claude text block text'))
            .join('');
        const toolCalls = Array.from(chatToolTrackers.values())
            .filter(tracker => tracker.id && tracker.name)
            .map(tracker => ({
                id: tracker.id,
                type: 'function',
                function: {
                    name: tracker.name,
                    arguments: tracker.args,
                },
            }));

        return this.wrap({
            role: 'assistant',
            content: toolCalls.length ? (content || null) : content,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        });
    }

    private createAssistantMsg(rawContent: unknown): ClaudeMessage {
        const content: UnknownList = [];
        if (typeof rawContent === 'string' && rawContent) {
            content.push({ type: 'text', text: rawContent });
        } else if (Array.isArray(rawContent)) {
            content.push(...rawContent);
        }
        return this.wrap({ role: 'assistant', content });
    }

    protected wrap(payload: ClaudeMessagePayload): ClaudeMessage {
        return { provider: 'anthropic', payload };
    }
}
