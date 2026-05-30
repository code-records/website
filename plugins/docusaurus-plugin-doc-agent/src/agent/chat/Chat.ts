import type { Agent, AgentEvent } from '../Agent';
import { History } from './History';
import { Message, type MessageJSON } from './Message';
import { Flow } from './round/Flow';

export interface ChatSendOptions {
    signal?: AbortSignal;
}

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

    async send(content: string, options: ChatSendOptions = {}): Promise<void> {
        for await (const _event of this.stream(content, options)) {
            void _event;
        }
    }

    stream(content: string, options: ChatSendOptions = {}): AsyncGenerator<AgentEvent, void, void> {
        const input = requireUserContent(content);
        const user = Message.user(input);
        const assistant = Message.assistant([new Flow({ input })]);
        return this.runPrepared(user, assistant, options.signal);
    }

    async runFlows(flows: Flow[], options: ChatSendOptions = {}): Promise<void> {
        for await (const _event of this.streamFlows(flows, options)) {
            void _event;
        }
    }

    streamFlows(flows: Flow[], options: ChatSendOptions = {}): AsyncGenerator<AgentEvent, void, void> {
        const assistant = Message.assistant(requireUserFlows(flows));
        return this.runPrepared(undefined, assistant, options.signal);
    }

    private async *runPrepared(user: Message | undefined, assistant: Message, signal?: AbortSignal): AsyncGenerator<AgentEvent, void, void> {
        if (this.activeMessage !== undefined) return;

        if (user !== undefined) {
            this.history.add(user);
        }
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

    toggleFlow(index: number): void {
        const assistantMessages = this.history.items.filter(message => message.role === 'assistant');
        const last = assistantMessages[assistantMessages.length - 1];
        const flow = last?.flows[index];
        if (flow !== undefined) {
            flow.toggle();
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

function requireUserContent(content: string): string {
    const normalizedContent = content.trim();
    if (!normalizedContent) {
        throw new Error('普通发送内容不能为空');
    }
    return normalizedContent;
}

function requireUserFlows(flows: Flow[]): Flow[] {
    if (flows.length === 0) {
        throw new Error('任务流不能为空');
    }
    for (const flow of flows) {
        if (!flow.input.trim()) {
            throw new Error(`任务流缺少 input: ${flow.formatLabel()}`);
        }
    }
    return flows;
}
