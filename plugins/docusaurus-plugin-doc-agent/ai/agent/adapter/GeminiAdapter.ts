import { parseSseStream } from '../utils/utils';
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

const DEFAULT_GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

type GeminiPart = UnknownRecord;
type GeminiMessagePayload = {
    parts: GeminiPart[];
    role: 'user' | 'model';
};
type GeminiMessage = AdapterMessage<GeminiMessagePayload>;
type GeminiMessageList = GeminiMessage[];

interface ToolTracker {
    action: Action;
    args: UnknownRecord;
    finalized?: boolean;
    id: string;
    name: string;
}

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

function stringifyToolContent(content: unknown): string {
    if (typeof content === 'string') return content;
    try {
        return JSON.stringify(content);
    } catch {
        return String(content ?? '');
    }
}

function normalizeSchema(value: unknown): UnknownRecord {
    const schema = isRecord(value) ? { ...value } : {};
    if (typeof schema.type === 'string') schema.type = schema.type.toUpperCase();

    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (Object.keys(properties).length > 0) {
        schema.properties = Object.fromEntries(
            Object.entries(properties).map(([key, child]) => [key, normalizeSchema(child)])
        );
    }

    const items = isRecord(schema.items) ? schema.items : {};
    if (Object.keys(items).length > 0) schema.items = normalizeSchema(items);

    return schema;
}

export class GeminiAdapter extends Adapter {
    private toolNamesById: Map<string, string>;

    constructor({ endpoint = DEFAULT_GEMINI_ENDPOINT, ...rest }: AdapterConfig = {}) {
        super({ endpoint: endpoint || DEFAULT_GEMINI_ENDPOINT, ...rest });
        this.toolNamesById = new Map();
    }

    async chat(messages: AdapterMessageList, toolDefs: ToolDefinitionList, system: string, signal?: AbortSignal, onStreamAction?: StreamActionCallback): Promise<AdapterChatResponse> {
        const body = this.buildGenerateContentBody(messages, toolDefs, system);
        const res = await this.fetchWithRetry(body, signal);
        const actions: Action[] = [];
        const toolCalls: ToolCallList = [];
        const parts: GeminiPart[] = [];
        const textAction = new Action({ type: 'content', content: '' });
        const toolTrackers = new Map<string, ToolTracker>();
        let textAdded = false;
        let finishReason = '';

        const emit = (action: Action, kind: 'add' | 'update') => {
            if (onStreamAction) onStreamAction(action, kind);
        };

        const appendText = (text: string) => {
            if (!text) return;
            if (!textAdded) {
                textAdded = true;
                actions.push(textAction);
                emit(textAction, 'add');
            }
            textAction.content += text;
            emit(textAction, 'update');
        };

        const addToolCall = (functionCall: UnknownRecord) => {
            const name = requireString(functionCall.name, 'Gemini function call name');

            const rawId = optionalString(functionCall.id);
            const id = rawId || `gemini_${name}_${toolCalls.length + 1}`;
            const trackerKey = id || `${name}:${toolCalls.length}`;
            if (toolTrackers.has(trackerKey)) return;

            const args = isRecord(functionCall.args) ? functionCall.args : {};
            const call: ToolCall = { id, name, input: args };
            this.toolNamesById.set(id, name);
            toolCalls.push(call);

            const action = new Action({ type: 'tool', call });
            actions.push(action);
            toolTrackers.set(trackerKey, { action, args, finalized: true, id, name });
            emit(action, 'add');
        };

        for await (const event of parseSseStream(res, { idleTimeout: 30000, signal })) {
            if (event.error !== undefined) {
                const error = requireRecord(event.error, 'Gemini stream error');
                throw new Error(optionalString(error.message) || 'Gemini stream failed');
            }

            if (event.candidates === undefined) continue;
            if (!Array.isArray(event.candidates)) throw new Error('Gemini candidates must be an array');

            for (const candidateValue of event.candidates) {
                const candidate = requireRecord(candidateValue, 'Gemini candidate');
                finishReason = optionalString(candidate.finishReason) || finishReason;
                const content = requireRecord(candidate.content, 'Gemini candidate content');
                if (!Array.isArray(content.parts)) throw new Error('Gemini content parts must be an array');
                for (const partValue of content.parts) {
                    const part = requireRecord(partValue, 'Gemini content part');
                    const text = optionalString(part.text);
                    if (text) {
                        parts.push({ text });
                        appendText(text);
                    }

                    if (part.functionCall !== undefined) {
                        const functionCall = requireRecord(part.functionCall, 'Gemini function call');
                        parts.push({ functionCall });
                        addToolCall(functionCall);
                    }
                }
            }
        }

        const status = toolCalls.length
            ? 'tool'
            : finishReason === 'MAX_TOKENS'
                ? 'continue'
                : 'final';

        return {
            actions,
            raw: this.createModelMsg(parts),
            status,
        };
    }

    formatToolDefs(tools: RuntimeTool[]): ToolDefinitionList {
        return tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: normalizeSchema(t.input_schema),
        }));
    }

    createUserMsg(content: string): GeminiMessage {
        return this.wrap({ role: 'user', parts: [{ text: content }] });
    }

    createAssistantTextMsg(content: string): GeminiMessage {
        return this.createModelMsg(content ? [{ text: content }] : []);
    }

    createToolResultMsg(toolUseId: string, content: unknown): GeminiMessage {
        const name = this.toolNamesById.get(toolUseId) || toolUseId;
        return this.wrap({
            role: 'user',
            parts: [{
                functionResponse: {
                    id: toolUseId,
                    name,
                    response: { result: content },
                },
            }],
        });
    }

    toApiMessages(messages: MessageList): GeminiMessageList {
        const result: GeminiMessageList = [];
        for (const msg of messages) {
            if (msg.local) continue;
            if (msg.role === 'user') {
                result.push(this.createUserMsg(msg.content));
                continue;
            }

            const plans = msg.plans || [];
            if (!plans.length) {
                if (msg.content) result.push(this.createAssistantTextMsg(msg.content));
                continue;
            }

            for (const plan of plans) {
                for (const round of plan.rounds || []) {
                    const modelParts: GeminiPart[] = [];
                    const responseParts: GeminiPart[] = [];
                    const flushModel = () => {
                        if (modelParts.length) result.push(this.createModelMsg(modelParts.splice(0)));
                    };
                    const flushResponses = () => {
                        if (responseParts.length) result.push(this.wrap({ role: 'user', parts: responseParts.splice(0) }));
                    };

                    for (const action of round.actions || []) {
                        if (action.type === 'content' && action.content) {
                            flushResponses();
                            modelParts.push({ text: action.content });
                        } else if (action.type === 'tool' && action.call) {
                            const call = action.call;
                            flushResponses();
                            modelParts.push({
                                functionCall: {
                                    id: call.id,
                                    name: call.name,
                                    args: call.input || {},
                                },
                            });
                            this.toolNamesById.set(call.id, call.name);
                            if ('result' in call) {
                                flushModel();
                                responseParts.push({
                                    functionResponse: {
                                        id: call.id,
                                        name: call.name,
                                        response: { result: call.result },
                                    },
                                });
                            }
                        }
                    }

                    flushModel();
                    flushResponses();
                }
            }

            if (msg.content) result.push(this.createAssistantTextMsg(msg.content));
        }
        return result;
    }

    protected buildStreamBody(messages: AdapterMessageList, system: string): unknown {
        return this.buildGenerateContentBody(messages, [], system);
    }

    protected parseStreamEvent(json: UnknownRecord): string | null | undefined {
        if (json.error !== undefined) {
            const error = requireRecord(json.error, 'Gemini stream error');
            throw new Error(optionalString(error.message) || 'Gemini stream failed');
        }

        let text = '';
        if (json.candidates === undefined) return undefined;
        if (!Array.isArray(json.candidates)) throw new Error('Gemini candidates must be an array');
        for (const candidateValue of json.candidates) {
            const candidate = requireRecord(candidateValue, 'Gemini candidate');
            const content = requireRecord(candidate.content, 'Gemini candidate content');
            if (!Array.isArray(content.parts)) throw new Error('Gemini content parts must be an array');
            for (const partValue of content.parts) {
                text += optionalString(requireRecord(partValue, 'Gemini content part').text);
            }
            if (candidate.finishReason === 'STOP') return text || null;
        }
        return text || undefined;
    }

    protected override buildUrl(): string {
        const base = this.endpoint.replace(/\/$/, '');
        if (/:streamGenerateContent(?:[?#]|$)/.test(base)) {
            return base.includes('?') ? `${base}&alt=sse` : `${base}?alt=sse`;
        }
        return `${base}/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse`;
    }

    protected override isToolCallMessage(message: AdapterMessage): boolean {
        if (message.provider !== 'gemini') return false;
        const payload = requireRecord(message.payload, 'Gemini message payload');
        return Array.isArray(payload.parts)
            && payload.parts.some(part => isRecord(part) && isRecord(part.functionCall));
    }

    protected override isToolResultMessage(message: AdapterMessage): boolean {
        if (message.provider !== 'gemini') return false;
        const payload = requireRecord(message.payload, 'Gemini message payload');
        return Array.isArray(payload.parts)
            && payload.parts.some(part => isRecord(part) && isRecord(part.functionResponse));
    }

    private buildGenerateContentBody(messages: AdapterMessageList, toolDefs: ToolDefinitionList, system: string): UnknownRecord {
        return {
            contents: this.toContents(messages),
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            ...(toolDefs.length ? {
                tools: [{ functionDeclarations: toolDefs }],
                toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
            } : {}),
        };
    }

    private toContents(messages: AdapterMessageList): UnknownList {
        return messages
            .filter(message => message.provider === 'gemini')
            .map(message => {
                const payload = requireRecord(message.payload, 'Gemini message payload');
                const role = payload.role === 'model' ? 'model' : 'user';
                if (!Array.isArray(payload.parts)) throw new Error('Gemini message parts must be an array');
                return {
                    role,
                    parts: payload.parts,
                };
            })
            .filter(message => message.parts.length > 0);
    }

    private createModelMsg(parts: GeminiPart[]): GeminiMessage {
        return this.wrap({ role: 'model', parts });
    }

    private wrap(payload: GeminiMessagePayload): GeminiMessage {
        return { provider: 'gemini', payload };
    }
}
