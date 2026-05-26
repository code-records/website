import type { ContextPatch } from '../tools/Tool';
import type { JsonObject, JsonValue } from '../tools/Tool';
import { ContextError } from '../utils/errors';

export type ContextChangeType = 'append' | 'replace' | 'compact';

/** 工具调用。 */
export interface ToolCall {
    id: string;
    name: string;
    input: JsonObject;
    result?: JsonValue;
}

export type ContextAction =
    | { type: 'thinking'; content: string }
    | { type: 'tool'; call: ToolCall };

export type ContextMessage =
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string; actions?: ContextAction[] }
    | { role: 'tool'; toolUseId: string; content: JsonValue };

/**
 * GUI / session 层的消息只需要满足这个最小形状，就可以投影成模型上下文。
 *
 * 注意：这里故意不读取 plan / round / action。那些是完整回答过程，
 * 默认不进入下一次模型请求的长期上下文。
 */
export interface ContextSourceMessage {
    content: string;
    local?: boolean;
    role: 'assistant' | 'user';
}

export interface ProjectMessagesToContextOptions {
    includeEmpty?: boolean;
    includeLocal?: boolean;
}

export interface ContextChange {
    after: readonly ContextMessage[];
    before: readonly ContextMessage[];
    patch: ContextPatch;
    summary?: string;
    type: ContextChangeType;
}

export class Context {
    private messages: ContextMessage[];

    constructor(initial: readonly ContextMessage[] = []) {
        this.messages = [...initial];
    }

    snapshot(): readonly ContextMessage[] {
        return [...this.messages];
    }

    toMessages(): ContextMessage[] {
        return [...this.messages];
    }

    append(messages: readonly ContextMessage[]): ContextChange {
        return this.apply({
            type: 'append',
            context: [...messages],
        });
    }

    replace(messages: readonly ContextMessage[]): ContextChange {
        return this.apply({
            type: 'replace',
            context: [...messages],
        });
    }

    compact(messages: readonly ContextMessage[], summary?: string): ContextChange {
        return this.apply({
            type: 'compact',
            context: [...messages],
            summary,
        });
    }

    apply(patch: ContextPatch): ContextChange {
        const before = this.snapshot();

        if (patch.type === 'append') {
            this.messages.push(...patch.context);
        } else if (patch.type === 'replace' || patch.type === 'compact') {
            this.messages = [...patch.context];
        } else {
            throw new ContextError(`Unsupported context patch type: ${String((patch as ContextPatch).type)}`);
        }

        return {
            after: this.snapshot(),
            before,
            patch,
            summary: patch.type === 'compact' ? patch.summary : undefined,
            type: patch.type,
        };
    }
}

export function createUserContextMessage(content: string): ContextMessage {
    return { content, role: 'user' };
}

export function createAssistantContextMessage(content = '', actions?: readonly ContextAction[]): ContextMessage {
    return {
        ...(actions !== undefined ? { actions: [...actions] } : {}),
        content,
        role: 'assistant',
    };
}

export function createToolResultContextMessage(toolUseId: string, content: JsonValue): ContextMessage {
    return { content, role: 'tool', toolUseId };
}

export function projectMessagesToContext(
    messages: readonly ContextSourceMessage[],
    { includeEmpty = false, includeLocal = false }: ProjectMessagesToContextOptions = {},
): ContextMessage[] {
    return messages.flatMap(message => {
        if (!includeLocal && message.local === true) {
            return [];
        }
        if (!includeEmpty && message.content.length === 0) {
            return [];
        }

        return message.role === 'user'
            ? [createUserContextMessage(message.content)]
            : [createAssistantContextMessage(message.content)];
    });
}
