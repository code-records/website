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
    readonly plans: Plan[] = [];
    readonly role: MessageRole;
    content: string;
    custom?: string;
    error?: string;
    isError = false;
    local = false;
    streaming = false;

    private constructor(role: MessageRole, content = '', plans: Plan[] = []) {
        this.role = role;
        this.content = content;
        this.plans = plans;
        this.streaming = role === 'assistant';
    }

    get plan(): Plan | undefined {
        return this.plans[0];
    }

    static user(content: string): Message {
        return new Message('user', content);
    }

    static assistant(): Message {
        return new Message('assistant', '', [new Plan()]);
    }

    static fromJSON(json: MessageJSON): Message {
        const plansJson = json.plans ?? (json.plan ? [json.plan] : []);
        const message = new Message(
            json.role,
            json.content,
            plansJson.map(p => Plan.fromJSON(p)),
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
            ...(this.plans.length > 0 ? { plan: this.plans[0].toJSON(), plans: this.plans.map(p => p.toJSON()) } : {}),
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
