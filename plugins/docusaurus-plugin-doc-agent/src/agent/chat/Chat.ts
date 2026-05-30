import type { Agent } from '../core/Agent';
import { AgentResult } from '../core/AgentResult';
import { Context, ContextMessage } from '../core/Context';
import type { AgentEvent } from '../core/type';
import { logger } from '../utils/logger';
import { Flow } from './Flow';
import { History } from './History';
import { Message, type MessageJSON } from './Message';

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
            for (const flow of assistant.flows) {
                if (runSignal?.aborted) break;
                if (flow.status !== 'pending') continue;

                for await (const event of this.runFlow(flow, assistant, runSignal)) {
                    this.notify();
                    yield event;
                }
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

    private async *runFlow(flow: Flow, assistant: Message, signal?: AbortSignal): AsyncGenerator<AgentEvent, void, void> {
        const context = this.projectContext(assistant, flow);
        const result = new AgentResult();
        flow.start(result);
        logger.flow('start', flow.toJSON());
        this.notify();

        try {
            for await (const event of this.agent.run({
                context,
                result,
                signal,
            })) {
                yield event;
            }
            flow.finish();
            logger.flow('done', flow.toJSON());
        } catch (error) {
            flow.fail();
            logger.flow('error', {
                ...flow.toJSON(),
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
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

    private projectContext(assistant: Message, currentFlow: Flow): Context {
        const context = new Context();

        for (const message of this.history.items) {
            if (message === assistant) {
                for (const flow of assistant.flows) {
                    if (flow === currentFlow) break;
                    if (flow.status !== 'completed' || flow.result === undefined) continue;
                    if (flow.input.trim().length === 0) continue;
                    context.append(ContextMessage.user(flow.input));
                    context.append(ContextMessage.assistant(flow.result.content, flow.result));
                }
                context.append(ContextMessage.user(currentFlow.input));
                continue;
            }

            if (message.role !== 'assistant') continue;
            for (const flow of message.flows) {
                if (flow.status !== 'completed' || flow.result === undefined) continue;
                if (flow.input.trim().length === 0) continue;
                context.append(ContextMessage.user(flow.input));
                context.append(ContextMessage.assistant(flow.result.content, flow.result));
            }
        }

        return context;
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
