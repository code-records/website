import { Message } from './Message';
import type { Agent } from '../Agent';
import type {
    Adapter,
    ChatOptions,
    MessageJSON,
    MessageJSONList,
    ModelOption,
    Notify,
} from '../types';

export class Chat {
    private _agent: Agent;
    private _modelOption: ModelOption;
    private _adapter: Adapter;
    private _onChange?: Notify;
    private _messages: Message[];
    activeMessage?: Message;

    constructor({ agent, modelOption, onChange }: ChatOptions) {
        this._agent = agent;
        if (modelOption === null || modelOption === undefined) throw new Error('Chat requires modelOption');
        this._modelOption = modelOption;
        this._adapter = agent.adapter(modelOption);
        this._onChange = onChange;
        this._messages = [];
        this.activeMessage = undefined;
    }

    get isSending(): boolean {
        return this.activeMessage !== undefined;
    }

    get modelOption(): ModelOption {
        return this._modelOption;
    }

    get messages(): Message[] {
        return this._messages;
    }

    setModelOption(modelOption: ModelOption): boolean {
        if (this.isSending || modelOption === null || modelOption === undefined) return false;

        const oldType = this._modelOption?.adapterType;
        this._bindModelOption(modelOption);

        if (oldType !== undefined && oldType !== modelOption.adapterType) {
            this.clear();
        }
        return true;
    }

    async send(content: unknown): Promise<void> {
        if (content === null || content === undefined || this.activeMessage !== undefined) return;

        const userContent = String(content);

        const ai = Message.assistant(() => this._notify());
        const userMsg = Message.user(userContent);
        const history = [
            ...this._messages.filter(message => message.local !== true),
            userMsg,
        ];

        this._messages.push(
            userMsg,
            ai
        );
        this.activeMessage = ai;
        this._notify();

        await ai.generate(this._agent, this._adapter, history, {
            system: this._agent.config.systemPrompt ?? null,
            signal: null,
        });

        if (this.activeMessage !== ai) return;
        this.activeMessage = undefined;
        this._notify();
    }

    addMessage(msg: MessageJSON): void {
        this._messages.push(Message.fromJSON(msg));
        this._notify();
    }

    removeLastMessage(): MessageJSON | undefined {
        const removed = this._messages.pop();
        if (removed === undefined) return undefined;
        this._notify();
        return removed.toJSON();
    }

    stop(): void {
        if (this.activeMessage !== undefined) this.activeMessage.stop();
    }

    clear(): void {
        if (this.activeMessage !== undefined) this.activeMessage.stop();
        this._messages = [];
        this.activeMessage = undefined;
        this._notify();
    }

    togglePlan(idx: number): void {
        if (this.activeMessage !== undefined) this.activeMessage.togglePlan(idx);
    }

    toJSON(): MessageJSONList {
        return this._messages.map(message => message.toJSON());
    }

    private _notify(): void {
        if (this._onChange !== undefined) this._onChange();
    }

    private _bindModelOption(modelOption: ModelOption): void {
        if (modelOption === null || modelOption === undefined) throw new Error('Chat requires modelOption');
        this._modelOption = modelOption;
        this._adapter = this._agent.adapter(modelOption);
    }
}
