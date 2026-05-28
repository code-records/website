import type { Agent, AgentEvent } from '../Agent';
import { History } from './History';
import { Message, type MessageJSON } from './Message';

export interface ChatOptions {
    agent: Agent;
    model?: string;
    onChange?: () => void;
    setAgentModel?: (agent: Agent, model: string) => void;
}

export class Chat {
    readonly agent: Agent;
    readonly history = new History();
    activeMessage?: Message;
    model?: string;

    private abortController?: AbortController;
    private readonly onChange?: () => void;
    private readonly setAgentModel?: (agent: Agent, model: string) => void;

    constructor({ agent, model, onChange, setAgentModel }: ChatOptions) {
        this.agent = agent;
        this.model = model;
        this.onChange = onChange;
        this.setAgentModel = setAgentModel;
        if (model !== undefined) {
            this.setAgentModel?.(this.agent, model);
        }
    }

    get isSending(): boolean {
        return this.activeMessage !== undefined;
    }

    get messages(): readonly Message[] {
        return this.history.items;
    }

    setModel(model: string): boolean {
        if (this.isSending) return false;
        this.model = model;
        this.setAgentModel?.(this.agent, model);
        return true;
    }

    async send(content: string, signal?: AbortSignal): Promise<void> {
        for await (const _event of this.stream(content, signal)) {
            void _event;
        }
    }

    async *stream(content: string, signal?: AbortSignal): AsyncGenerator<AgentEvent, void, void> {
        if (this.activeMessage !== undefined) return;

        const user = Message.user(content);
        const assistant = Message.assistant(this.agent.definePlans());
        this.history.add(user);
        this.history.add(assistant);
        this.activeMessage = assistant;
        this.abortController = new AbortController();
        this.notify();

        const runSignal = signal ?? this.abortController.signal;

        try {
            for await (const event of this.agent.run({ messages: this.history.items, signal: runSignal })) {
                this.notify();
                yield event;
            }
        } catch (error) {
            assistant.fail(error instanceof Error ? error.message : String(error));
        } finally {
            if (this.activeMessage === assistant) {
                this.activeMessage = undefined;
            }
            this.abortController = undefined;
            this.notify();
        }
    }

    stop(): void {
        this.abortController?.abort();
    }

    clear(): void {
        this.stop();
        this.history.clear();
        this.activeMessage = undefined;
        this.notify();
    }

    addMessage(message: MessageJSON): void {
        this.history.add(Message.fromJSON(message));
        this.notify();
    }

    removeLastMessage(): MessageJSON | undefined {
        const removed = this.history.pop();
        this.notify();
        return removed?.toJSON();
    }

    togglePlan(index: number): void {
        const assistantMessages = this.history.items.filter(message => message.role === 'assistant');
        const last = assistantMessages[assistantMessages.length - 1];
        if (last?.plan !== undefined && index === 0) {
            last.plan.toggle();
            this.notify();
        }
    }

    toJSON(): MessageJSON[] {
        return this.history.items.map(message => message.toJSON());
    }

    private notify(): void {
        this.onChange?.();
    }
}
