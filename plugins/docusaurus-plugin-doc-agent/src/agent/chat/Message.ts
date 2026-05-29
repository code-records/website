import { Plan, type PlanJSON } from './round/Plan';

export type MessageRole = 'assistant' | 'user';

export interface MessageJSON {
    custom?: string;
    error?: string;
    isError?: boolean;
    local?: boolean;
    plans?: PlanJSON[];
    role: MessageRole;
    streaming?: boolean;
}

export class Message {
    readonly plans: Plan[] = [];
    readonly role: MessageRole;
    custom?: string;
    error?: string;
    isError = false;
    local = false;
    streaming = false;

    private constructor(role: MessageRole, plans: Plan[] = []) {
        this.role = role;
        this.plans = plans;
        this.plans.forEach((plan, index) => {
            if (plan.count === 0) {
                plan.count = index + 1;
            }
        });
        this.streaming = role === 'assistant';
    }

    /**
     * Message deliberately has no text/content field.
     * User/local text is stored in Round.text so every textual payload stays inside Plan/Round/Action.
     */
    static user(text: string): Message {
        const plan = new Plan();
        if (text.length > 0) {
            plan.appendUserText(text);
        }
        plan.finish();
        return new Message('user', [plan]);
    }

    static assistant(plans: Plan[] = [new Plan()]): Message {
        return new Message('assistant', plans);
    }

    static fromJSON(json: MessageJSON): Message {
        const plansJson = json.plans ?? [];
        const message = new Message(
            json.role,
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
            ...(this.custom !== undefined ? { custom: this.custom } : {}),
            ...(this.error !== undefined ? { error: this.error } : {}),
            ...(this.isError ? { isError: true } : {}),
            ...(this.local ? { local: true } : {}),
            ...(this.plans.length > 0 ? { plans: this.plans.map(p => p.toJSON()) } : {}),
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
