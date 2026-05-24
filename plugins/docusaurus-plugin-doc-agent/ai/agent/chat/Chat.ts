import { Message } from './Message';
import type { Agent } from '../Agent';
import type {
    Adapter,
    ChatOptions,
    MessageJSON,
    MessageJSONList,
    ModelSelection,
    Notify,
} from '../types';

export class Chat {
    private _agent: Agent;
    private _modelSelection: ModelSelection;
    private _adapter: Adapter;
    private _onChange?: Notify;
    private _messages: Message[];
    activeMessage?: Message;

    constructor({ agent, modelSelection, onChange }: ChatOptions) {
        this._agent = agent;
        if (modelSelection === null || modelSelection === undefined) throw new Error('Chat requires modelSelection');
        this._modelSelection = modelSelection;
        this._adapter = agent.adapter(modelSelection);
        this._onChange = onChange;
        this._messages = [];
        this.activeMessage = undefined;
    }

    get isSending(): boolean {
        return this.activeMessage !== undefined;
    }

    get modelSelection(): ModelSelection {
        return this._modelSelection;
    }

    get messages(): Message[] {
        return this._messages;
    }

    setModelSelection(modelSelection: ModelSelection): boolean {
        if (this.isSending || modelSelection === null || modelSelection === undefined) return false;

        const oldAdapter = this._agent.providers[this._modelSelection.provider]?.adapter;
        this._bindModelSelection(modelSelection);

        const nextAdapter = this._agent.providers[modelSelection.provider]?.adapter;
        if (oldAdapter !== undefined && oldAdapter !== nextAdapter) {
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

    private _bindModelSelection(modelSelection: ModelSelection): void {
        if (modelSelection === null || modelSelection === undefined) throw new Error('Chat requires modelSelection');
        this._modelSelection = modelSelection;
        this._adapter = this._agent.adapter(modelSelection);
    }
}
