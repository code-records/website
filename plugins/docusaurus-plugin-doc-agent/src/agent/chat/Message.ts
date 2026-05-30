import { Flow, type FlowJSON } from './Flow';

export type MessageRole = 'assistant' | 'user';

export interface MessageJSON {
    content?: string;
    custom?: string;
    error?: string;
    flows?: FlowJSON[];
    isError?: boolean;
    local?: boolean;
    role: MessageRole;
    streaming?: boolean;
}

export class Message {
    readonly flows: Flow[] = [];
    readonly role: MessageRole;
    content = '';
    custom?: string;
    error?: string;
    isError = false;
    local = false;
    streaming = false;

    private constructor(role: MessageRole, content = '', flows: Flow[] = []) {
        this.role = role;
        this.content = content;
        this.flows = flows;
        this.flows.forEach((flow, index) => {
            if (flow.count === 0) {
                flow.count = index + 1;
            }
        });
        this.streaming = role === 'assistant';
    }

    static user(content: string): Message {
        return new Message('user', content);
    }

    static assistant(flows: Flow[] = []): Message {
        return new Message('assistant', '', flows);
    }

    static fromJSON(json: MessageJSON): Message {
        const message = new Message(
            json.role,
            json.content ?? '',
            (json.flows ?? []).map(flow => Flow.fromJSON(flow)),
        );
        message.custom = json.custom;
        message.error = json.error;
        message.isError = json.isError === true;
        message.local = json.local === true;
        message.streaming = json.streaming === true;
        return message;
    }

    finish(): void {
        this.streaming = false;
    }

    fail(error: string): void {
        this.streaming = false;
        this.error = error;
        this.isError = true;
    }

    toJSON(): MessageJSON {
        return {
            role: this.role,
            ...(this.content.length > 0 ? { content: this.content } : {}),
            ...(this.custom !== undefined ? { custom: this.custom } : {}),
            ...(this.error !== undefined ? { error: this.error } : {}),
            ...(this.flows.length > 0 ? { flows: this.flows.map(flow => flow.toJSON()) } : {}),
            ...(this.isError ? { isError: true } : {}),
            ...(this.local ? { local: true } : {}),
            ...(this.streaming ? { streaming: true } : {}),
        };
    }
}
