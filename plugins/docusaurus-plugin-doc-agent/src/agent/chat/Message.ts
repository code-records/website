import { Flow, type FlowJSON } from './round/Flow';

export type MessageRole = 'assistant' | 'user';

export interface MessageJSON {
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
    custom?: string;
    error?: string;
    isError = false;
    local = false;
    streaming = false;

    private constructor(role: MessageRole, flows: Flow[] = []) {
        this.role = role;
        this.flows = flows;
        this.flows.forEach((flow, index) => {
            if (flow.count === 0) {
                flow.count = index + 1;
            }
        });
        this.streaming = role === 'assistant';
    }

    /**
     * Message deliberately has no text/content field.
     * User/local text is stored in Round.text so every textual payload stays inside Flow/Round/Action.
     */
    static user(text: string): Message {
        const flow = new Flow();
        if (text.length > 0) {
            flow.appendUserText(text);
        }
        flow.finish();
        return new Message('user', [flow]);
    }

    static assistant(flows: Flow[] = [new Flow()]): Message {
        if (flows.length === 0) {
            throw new Error('Assistant message requires at least one flow');
        }
        return new Message('assistant', flows);
    }

    static fromJSON(json: MessageJSON): Message {
        const flowsJson = json.flows ?? [];
        const message = new Message(
            json.role,
            flowsJson.map(flow => Flow.fromJSON(flow)),
        );
        message.custom = json.custom;
        message.error = json.error;
        message.isError = json.isError === true;
        message.local = json.local === true;
        message.streaming = json.streaming === true;
        return message;
    }

    toJSON(): MessageJSON {
        return {
            role: this.role,
            ...(this.custom !== undefined ? { custom: this.custom } : {}),
            ...(this.error !== undefined ? { error: this.error } : {}),
            ...(this.flows.length > 0 ? { flows: this.flows.map(flow => flow.toJSON()) } : {}),
            ...(this.isError ? { isError: true } : {}),
            ...(this.local ? { local: true } : {}),
            ...(this.streaming ? { streaming: true } : {}),
        };
    }

    finish(): void {
        this.streaming = false;
    }

    fail(error: string): void {
        this.streaming = false;
        this.error = error;
        this.isError = true;
    }
}
