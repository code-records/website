import { AgentResult, type AgentResultJSON } from './AgentResult';

export type ContextMessageRole = 'assistant' | 'system' | 'user';

export interface ContextMessageJSON {
    content: string;
    kind?: 'context_message';
    result?: AgentResultJSON;
    role: ContextMessageRole;
}

export interface ContextJSON {
    kind?: 'context';
    messages: ContextMessageJSON[];
    summary?: string;
}

export interface ContextOptions {
    messages?: readonly ContextMessage[];
    summary?: string;
}

export class ContextMessage {
    readonly kind = 'context_message';
    readonly role: ContextMessageRole;
    content: string;
    result?: AgentResult;

    constructor(role: ContextMessageRole, content: string, result?: AgentResult) {
        const text = content.trim();
        if (text.length === 0 && result === undefined) {
            throw new Error('Context message content cannot be empty');
        }
        this.role = role;
        this.content = text;
        this.result = result;
    }

    static system(content: string): ContextMessage {
        return new ContextMessage('system', content);
    }

    static user(content: string): ContextMessage {
        return new ContextMessage('user', content);
    }

    static assistant(content: string, result?: AgentResult): ContextMessage {
        return new ContextMessage('assistant', content, result);
    }

    static fromJSON(json: ContextMessageJSON): ContextMessage {
        return new ContextMessage(
            json.role,
            json.content,
            json.result !== undefined ? AgentResult.fromJSON(json.result) : undefined,
        );
    }

    clone(): ContextMessage {
        return new ContextMessage(
            this.role,
            this.content,
            this.result !== undefined ? AgentResult.fromJSON(this.result.toJSON()) : undefined,
        );
    }

    toJSON(): ContextMessageJSON {
        return {
            kind: this.kind,
            role: this.role,
            content: this.content,
            ...(this.result !== undefined ? { result: this.result.toJSON() } : {}),
        };
    }
}

/**
 * Input environment for one Agent.run() call.
 *
 * Context is run-scoped and mutable by tools through ContextPatch. It is not
 * chat history storage, not runtime state, and not the AgentResult output.
 */
export class Context {
    readonly kind = 'context';
    summary: string;
    private readonly _messages: ContextMessage[];

    constructor({ messages = [], summary = '' }: ContextOptions = {}) {
        this._messages = [...messages];
        this.summary = summary.trim();
    }

    get messages(): readonly ContextMessage[] {
        return this._messages;
    }

    get length(): number {
        return this._messages.length;
    }

    append(message: ContextMessage): ContextMessage {
        this._messages.push(message);
        return message;
    }

    appendMany(messages: readonly ContextMessage[]): void {
        this._messages.push(...messages);
    }

    merge(context: Context): void {
        this._messages.push(...context.messages);
        if (context.summary.length > 0) {
            this.summary = [this.summary, context.summary].filter(Boolean).join('\n\n');
        }
    }

    clone(): Context {
        return new Context({
            messages: this._messages.map(message => message.clone()),
            summary: this.summary,
        });
    }

    static from(input: string | Context | readonly ContextMessage[]): Context {
        if (typeof input === 'string') {
            return new Context({ messages: [ContextMessage.user(input)] });
        }
        if (input instanceof Context) {
            return input.clone();
        }
        return new Context({ messages: input });
    }

    static fromJSON(json: ContextJSON): Context {
        return new Context({
            messages: json.messages.map(message => ContextMessage.fromJSON(message)),
            summary: json.summary ?? '',
        });
    }

    toJSON(): ContextJSON {
        return {
            kind: this.kind,
            messages: this._messages.map(message => message.toJSON()),
            ...(this.summary.length > 0 ? { summary: this.summary } : {}),
        };
    }
}
