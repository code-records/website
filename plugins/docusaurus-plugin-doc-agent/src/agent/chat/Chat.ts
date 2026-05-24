import type { Agent, AgentEvent } from '../Agent';
import type { ModelMessage } from '../model/Model';
import { History } from './History';
import { Message, type MessageJSON } from './Message';

export interface ChatOptions {
    agent: Agent;
    modelSelection?: unknown;
    onChange?: () => void;
    setAgentModel?: (agent: Agent, modelSelection: unknown) => void;
}

export class Chat {
    readonly agent: Agent;
    readonly history = new History();
    activeMessage?: Message;
    modelSelection?: unknown;

    private abortController?: AbortController;
    private readonly onChange?: () => void;
    private readonly setAgentModel?: (agent: Agent, modelSelection: unknown) => void;

    constructor({ agent, modelSelection, onChange, setAgentModel }: ChatOptions) {
        this.agent = agent;
        this.modelSelection = modelSelection;
        this.onChange = onChange;
        this.setAgentModel = setAgentModel;
        if (modelSelection !== undefined) {
            this.setAgentModel?.(this.agent, modelSelection);
        }
    }

    get isSending(): boolean {
        return this.activeMessage !== undefined;
    }

    get messages(): readonly Message[] {
        return this.history.items;
    }

    setModelSelection(modelSelection: unknown): boolean {
        if (this.isSending) return false;
        this.modelSelection = modelSelection;
        this.setAgentModel?.(this.agent, modelSelection);
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
        const assistant = Message.assistant();
        this.history.add(user);
        this.history.add(assistant);
        this.activeMessage = assistant;
        this.abortController = new AbortController();
        this.notify();

        const context = this.toContext();
        const runSignal = signal ?? this.abortController.signal;

        try {
            for await (const event of this.agent.run({ context, signal: runSignal })) {
                assistant.plan?.apply(event);
                if (event.type === 'model_event' && event.event.type === 'content_delta') {
                    assistant.content += event.event.content;
                }
                if (event.type === 'agent_error') {
                    assistant.fail(event.error.message);
                }
                this.notify();
                yield event;
            }
            assistant.finish();
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

    toContext(): ModelMessage[] {
        return this.history.items
            .filter(message => message.content.length > 0 && message.local !== true)
            .map(message => message.toContextMessage(
                content => this.agent.createUserContextMessage(content),
                content => this.agent.createAssistantContextMessage(content),
            ));
    }

    private notify(): void {
        this.onChange?.();
    }
}
