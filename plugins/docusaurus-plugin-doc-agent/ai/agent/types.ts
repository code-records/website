import { Adapter } from './adapter/Adapter';
import type { Action } from './round/Action';
import type { Agent } from './Agent';
import type { Message } from './chat/Message';
import type { Round } from './round/Round';
import type {
    DocAgentProviderAdapter,
    DocAgentProviderOption,
    DocAgentProviders,
} from '../../src';
export { Adapter };

export interface UnknownRecord {
    [key: string]: unknown;
}

export interface UnknownList extends Array<unknown> {
}

export interface ValueList extends Array<unknown> {
}

export interface LogData extends UnknownRecord {
}

export type AdapterProvider = DocAgentProviderAdapter;

export interface AgentConfig extends UnknownRecord {
    baseUrl?: string;
    compactKeepTail?: number;
    compactPrompt?: string;
    compactThreshold?: number;
    debug?: boolean;
    docsRoot?: string;
    maxRounds?: number;
    systemPrompt?: string;
}

export interface AgentOptions {
    config?: AgentConfig;
    providers?: ProviderMap;
    tools?: AgentToolList;
}

export interface AdapterConfig extends UnknownRecord {
    endpoint?: string;
    model?: string;
}

export type ProviderConfig = DocAgentProviderOption;
export type ProviderMap = DocAgentProviders;

export interface ToolInput extends UnknownRecord {
}

export interface ToolEvent extends UnknownRecord {
    type?: string;
}

export type ToolResultValue = string | number | boolean | null | UnknownRecord | UnknownList;

export interface ToolResult<
    TResult extends ToolResultValue = ToolResultValue,
    TEvent extends ToolEvent = ToolEvent,
> {
    event?: TEvent;
    result: TResult;
}

export interface ToolSchema extends UnknownRecord {
    type?: string;
}

export interface AgentTool<
    TName extends string = string,
    TInput extends ToolInput = ToolInput,
    TResult extends ToolResultValue = ToolResultValue,
    TEvent extends ToolEvent = ToolEvent,
> {
    description: string;
    execute(input: TInput): Promise<ToolResult<TResult, TEvent>>;
    input_schema: ToolSchema;
    name: TName;
    timeout?: number;
    endText?(event: TEvent, input: TInput): string;
    startText?(input: TInput): string;
}

export interface RuntimeTool {
    description: string;
    execute(input: ToolInput): Promise<ToolResult>;
    input_schema: ToolSchema;
    name: string;
    timeout?: number;
    endText?(event: ToolEvent, input: ToolInput): string;
    startText?(input: ToolInput): string;
}

export type AgentToolList = RuntimeTool[];
export type AgentToolLists = AgentToolList[];

export interface ToolMap {
    [name: string]: RuntimeTool;
}

// ==================== JSON snapshots: Action / Round / Plan ====================

export interface ToolCall {
    id: string;
    input: ToolInput;
    name: string;
    result?: ToolResultValue;
}

export const ActionType = Object.freeze({
    THINKING: 'thinking',
    TOOL: 'tool',
    CONTENT: 'content',
} as const);

export type ActionTypeName = (typeof ActionType)[keyof typeof ActionType];

export interface ActionJSON {
    type: ActionTypeName;
    content?: string;
    call?: ToolCall;
    done?: boolean;
    event?: ToolEvent;
    label?: string;
}

export interface RoundJSON {
    actions: ActionJSON[];
    hasContent?: boolean;
    isActive?: boolean;
    label?: string;
}

export interface PlanJSON {
    expanded?: boolean;
    hasContent?: boolean;
    isActive?: boolean;
    label?: string;
    rounds: RoundJSON[];
    status?: PlanStatus;
}

export type ToolCallList = ToolCall[];
export type PlanJSONList = PlanJSON[];

export type StreamActionCallback = (action: Action, kind: 'add' | 'update') => void;


// ==================== Message ====================

export interface MessageMeta {
    a2ui?: unknown;
    custom?: string;
    error?: string;
    isError?: boolean;
    local?: boolean;
    streaming?: boolean;
}

export type MessageRole = 'user' | 'assistant';
export type PlanStatus = 'active' | 'completed' | 'failed';

export interface UserMessageJSON extends MessageMeta {
    content: string;
    plans?: never;
    role: 'user';
}

export interface AssistantMessageJSON extends MessageMeta {
    content: string;
    plans?: PlanJSONList;
    role: 'assistant';
}

export type MessageJSON = UserMessageJSON | AssistantMessageJSON;
export type MessageJSONList = MessageJSON[];
export type MessageList = Message[];

export interface ToolDefinition extends UnknownRecord {
    description?: string;
    input_schema?: ToolSchema;
    name?: string;
}

export interface ToolDefinitionList extends Array<ToolDefinition> {
}


// ==================== Adapter ====================

export interface AdapterMessage<TPayload = unknown> {
    payload: TPayload;
    provider: AdapterProvider;
}

export type AdapterMessageList = AdapterMessage[];

export type AdapterChatStatus = 'tool' | 'final' | 'continue';

export interface AdapterChatResponse {
    actions: Action[];
    raw: AdapterMessage;
    status: AdapterChatStatus;
}

export interface StreamEvent extends UnknownRecord {
    content?: string;
    type: string;
}


// ==================== Loop ====================

export interface Notify {
    (): void;
}

export interface AgentLoopOptions {
    adapter: Adapter;
    compact: CompactOptions | null;
    history: MessageList;
    maxRounds: number;
    notify: Notify | null;
    rounds: Round[];
    signal: AbortSignal | null;
    system: string;
    tools: ToolMap;
}


// ==================== Compact / Session ====================

export interface CompactOptions {
    compactPrompt: string | null;
    keepTail: number;
    threshold: number;
}

export interface CompactStats {
    afterTokens: number;
    beforeTokens: number;
    compactedEndIndex?: number;
    compactedStartIndex?: number;
    keptCount: number;
    summarizedCount: number;
}

export interface CompactResult {
    compacted: boolean;
    error?: unknown;
    messages: AdapterMessageList;
    stats?: CompactStats;
}

export interface SessionData {
    messages: MessageJSONList;
    meta: UnknownRecord;
}

export interface SessionLoadResult extends SessionData {
}

export interface SessionListItem {
    key: string;
    messageCount: number;
    meta: UnknownRecord;
}

export interface SessionList extends Array<SessionListItem> {
}


// ==================== Options ====================

export interface RunOnceOptions {
    messages: MessageJSONList | null;
    model: string;
    signal: AbortSignal | null;
    system: string | null;
}

export interface FinalizeRoundOptions {
    adapter: Adapter;
    messages: AdapterMessageList;
    signal: AbortSignal | null;
    system: string;
}

export interface SendOptions {
    signal: AbortSignal | null;
    system: string | null;
}

export interface ChatOptions {
    agent: Agent;
    model: string;
    onChange?: Notify;
}
