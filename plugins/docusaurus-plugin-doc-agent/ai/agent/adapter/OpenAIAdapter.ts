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

const DEFAULT_OPENAI_ENDPOINT = '/agent/v1/responses';

type OpenAIMessagePayload = UnknownRecord;
type OpenAIMessage = AdapterMessage<OpenAIMessagePayload>;
type OpenAIMessageList = OpenAIMessage[];

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

function optionalString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function optionalList(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function hasContentBlockType(content: unknown, type: string): boolean {
    return Array.isArray(content) && content.some(block => isRecord(block) && block.type === type);
}

export class OpenAIAdapter extends Adapter {
    constructor({ endpoint = DEFAULT_OPENAI_ENDPOINT, ...rest }: AdapterConfig = {}) {
        super({ endpoint: endpoint || DEFAULT_OPENAI_ENDPOINT, ...rest });
    }

    async chat(messages: AdapterMessageList, toolDefs: ToolDefinitionList, system: string, signal?: AbortSignal, onStreamAction?: StreamActionCallback): Promise<AdapterChatResponse> {
        const input = this.toResponsesInput(messages);
        const body = {
            model: this.model,
            input,
            ...(system ? { instructions: system } : {}),
            stream: true,
            ...(toolDefs?.length ? { tools: this.toResponsesTools(toolDefs) } : {}),
        };

        const res = await this.fetchWithRetry(body, signal);

        const output: UnknownList = [];
        const actions: Action[] = [];
        const toolCalls: ToolCallList = [];
        const messageActions = new Map<string, Action>();
        const reasoningActions = new Map<string, Action>();
        const toolActionByItemId = new Map<string, { action: Action; args: string }>();
        let finalStatus = '';
        let outputText = '';

        const emit = (action: Action, kind: 'add' | 'update') => {
            if (onStreamAction) onStreamAction(action, kind);
        };

        const appendContent = (itemId: string, delta: string, type: 'content' | 'thinking') => {
            if (!delta) return;
            const bucket = type === 'content' ? messageActions : reasoningActions;
            let action = bucket.get(itemId);
            if (!action) {
                action = new Action({ type, content: '' });
                bucket.set(itemId, action);
                actions.push(action);
                emit(action, 'add');
            }
            action.content += delta;
            emit(action, 'update');
        };

        for await (const event of parseSseStream(res, { idleTimeout: 30000, signal })) {
            const type = requireString(event.type, 'OpenAI stream event type');

            if (type === 'response.output_item.added') {
                const item = requireRecord(event.item, 'OpenAI output item');
                if (item.type !== 'function_call') continue;
                const itemId = requireString(item.id, 'OpenAI output item id');
                const callId = typeof item.call_id === 'string' ? item.call_id : itemId;
                const name = requireString(item.name, 'OpenAI function call name');
                const call: ToolCall = { id: callId, name, input: {} };
                const action = new Action({ type: 'tool', call });
                toolCalls.push(call);
                actions.push(action);
                toolActionByItemId.set(itemId, { action, args: optionalString(item.arguments) });
                emit(action, 'add');
                continue;
            }

            if (type === 'response.output_text.delta') {
                appendContent(requireString(event.item_id, 'OpenAI output text item_id'), requireString(event.delta, 'OpenAI output text delta'), 'content');
                continue;
            }

            if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
                appendContent(requireString(event.item_id, 'OpenAI reasoning item_id'), requireString(event.delta, 'OpenAI reasoning delta'), 'thinking');
                continue;
            }

            if (type === 'response.function_call_arguments.delta') {
                const tracker = toolActionByItemId.get(requireString(event.item_id, 'OpenAI function call item_id'));
                if (tracker) tracker.args += requireString(event.delta, 'OpenAI function call arguments delta');
                continue;
            }

            if (type === 'response.output_item.done') {
                const item = requireRecord(event.item, 'OpenAI completed output item');
                output.push(item);
                if (item.type === 'function_call') {
                    const itemId = requireString(item.id, 'OpenAI completed function call id');
                    const tracker = toolActionByItemId.get(itemId);
                    const argsStr = optionalString(item.arguments) || tracker?.args || '';
                    if (tracker?.action.call) {
                        tracker.action.call.input = safeParse(argsStr);
                        emit(tracker.action, 'update');
                    }
                }
                continue;
            }

            if (type === 'response.completed' || type === 'response.incomplete') {
                const response = requireRecord(event.response, 'OpenAI response');
                finalStatus = requireString(response.status, 'OpenAI response status');
                outputText = optionalString(response.output_text);
                if (!output.length) output.push(...optionalList(response.output));
                break;
            }

            if (type === 'response.failed') {
                const response = requireRecord(event.response, 'OpenAI failed response');
                const error = requireRecord(response.error, 'OpenAI response error');
                throw new Error(optionalString(error.message) || 'Responses stream failed');
            }
        }

        if (!actions.length && outputText) {
            const action = new Action({ type: 'content', content: outputText.trim() });
            actions.push(action);
            emit(action, 'add');
        }

        const status = toolCalls.length
            ? 'tool'
            : finalStatus === 'incomplete'
                ? 'continue'
                : 'final';

        return {
            actions,
            raw: this.createAssistantMsg(output),
            status,
        };
    }

    formatToolDefs(tools: RuntimeTool[]): ToolDefinitionList {
        return tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
        }));
    }

    createUserMsg(content: string): OpenAIMessage {
        return this.wrap({ role: 'user', content });
    }

    createAssistantTextMsg(content: string): OpenAIMessage {
        return this.wrap({ role: 'assistant', content });
    }

    createToolResultMsg(toolUseId: string, content: unknown): OpenAIMessage {
        return this.wrap({ type: 'function_call_output', call_id: toolUseId, output: content });
    }

    toApiMessages(messages: MessageList): OpenAIMessageList {
        const result: OpenAIMessageList = [];
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
                            const toolResults: OpenAIMessageList = [];
                            const flushToolResults = () => {
                                if (!toolResults.length) return;
                                result.push(...toolResults.splice(0));
                            };

                            for (const action of round.actions || []) {
                                if (action.type === 'content' && action.content) {
                                    flushToolResults();
                                    result.push(this.wrap({ role: 'assistant', content: action.content }));
                                } else if (action.type === 'tool' && action.call) {
                                    const tc = action.call;
                                    result.push(this.wrap({
                                        type: 'function_call',
                                        call_id: tc.id,
                                        name: tc.name,
                                        arguments: JSON.stringify(tc.input || {}),
                                    }));
                                    if ('result' in tc) {
                                        toolResults.push(this.wrap({
                                            type: 'function_call_output',
                                            call_id: tc.id,
                                            output: tc.result,
                                        }));
                                    }
                                }
                            }
                            flushToolResults();
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
            input: this.toResponsesInput(messages),
            ...(system ? { instructions: system } : {}),
            stream: true,
        };
    }

    protected parseStreamEvent(json: UnknownRecord): string | null | undefined {
        if (json.type === 'response.output_text.delta' && json.delta) {
            return requireString(json.delta, 'OpenAI output text delta');
        }
        if (json.type === 'response.failed') {
            const response = requireRecord(json.response, 'OpenAI failed response');
            const error = requireRecord(response.error, 'OpenAI response error');
            throw new Error(optionalString(error.message) || 'Responses stream failed');
        }
        if (json.type === 'response.completed') return null;
        return undefined;
    }

    protected override isToolCallMessage(message: AdapterMessage): boolean {
        if (message.provider !== 'openai') return false;
        const payload = requireRecord(message.payload, 'OpenAI message payload');
        return payload.type === 'function_call'
            || hasContentBlockType(payload.content, 'function_call');
    }

    protected override isToolResultMessage(message: AdapterMessage): boolean {
        return message.provider === 'openai'
            && requireRecord(message.payload, 'OpenAI message payload').type === 'function_call_output';
    }

    private textContent(content: unknown, inputType = 'input_text'): UnknownList {
        const text = String(content ?? '');
        return text ? [{ type: inputType, text }] : [];
    }

    private toResponsesInput(messages: AdapterMessageList): UnknownList {
        const result: UnknownList = [];

        const pushMessage = (role: string, content: unknown) => {
            if (Array.isArray(content) && !content.length) return;
            if (typeof content === 'string' && !content) return;
            result.push({ role, content });
        };

        for (const message of messages) {
            const msg = requireRecord(message.payload, 'OpenAI message payload');
            if (msg.type === 'function_call_output') {
                result.push(msg);
                continue;
            }
            if (msg.role === 'assistant' && Array.isArray(msg.content)) {
                result.push(...msg.content);
                continue;
            }
            if (msg.role === 'user') {
                pushMessage('user', this.textContent(msg.content));
            } else if (msg.role === 'assistant') {
                pushMessage('assistant', this.textContent(msg.content, 'output_text'));
            } else if (msg.type) {
                result.push(msg);
            }
        }
        return result;
    }

    private toResponsesTools(tools: ToolDefinitionList): ToolDefinitionList {
        return tools.map(t => ({
            type: 'function',
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
            strict: false,
        }));
    }

    private createAssistantMsg(rawContent: unknown): OpenAIMessage {
        if (Array.isArray(rawContent)) return this.wrap({ role: 'assistant', content: rawContent });
        return this.wrap({ role: 'assistant', content: rawContent ? this.textContent(rawContent, 'output_text') : [] });
    }

    protected wrap(payload: OpenAIMessagePayload): OpenAIMessage {
        return { provider: 'openai', payload };
    }
}
