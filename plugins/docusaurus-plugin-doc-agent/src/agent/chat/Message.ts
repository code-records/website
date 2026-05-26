import { Plan, type PlanJSON } from './round/Plan';

export type MessageRole = 'assistant' | 'user';

export interface MessageJSON {
    content: string;
    custom?: string;
    error?: string;
    isError?: boolean;
    local?: boolean;
    plan?: PlanJSON;
    plans?: PlanJSON[];
    role: MessageRole;
    streaming?: boolean;
}

export class Message {
    readonly plan?: Plan;
    readonly role: MessageRole;
    content: string;
    custom?: string;
    error?: string;
    isError = false;
    local = false;
    streaming = false;

    private constructor(role: MessageRole, content = '', plan?: Plan) {
        this.role = role;
        this.content = content;
        this.plan = plan;
        this.streaming = role === 'assistant';
    }

    static user(content: string): Message {
        return new Message('user', content);
    }

    static assistant(): Message {
        return new Message('assistant', '', new Plan());
    }

    static fromJSON(json: MessageJSON): Message {
        const planJson = json.plan ?? json.plans?.[0];
        const message = new Message(
            json.role,
            json.content,
            planJson !== undefined ? Plan.fromJSON(planJson) : undefined,
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
            content: this.content,
            ...(this.custom !== undefined ? { custom: this.custom } : {}),
            ...(this.error !== undefined ? { error: this.error } : {}),
            ...(this.isError ? { isError: true } : {}),
            ...(this.local ? { local: true } : {}),
            ...(this.plan !== undefined ? { plan: this.plan.toJSON(), plans: [this.plan.toJSON()] } : {}),
            role: this.role,
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
