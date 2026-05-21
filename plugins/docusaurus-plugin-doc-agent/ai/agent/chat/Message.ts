import { Plan } from '../round/Plan';
import { ActionType } from '../types';
import type { Agent } from '../Agent';
import type {
    Adapter,
    CompactOptions,
    MessageJSON,
    MessageRole,
    Notify,
    SendOptions,
} from '../types';
import type { Round } from '../round/Round';

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function getRoundContent(round: Round): string {
    return round.actions
        .filter(action => action.type === ActionType.CONTENT && action.content.length > 0)
        .map(action => action.content)
        .join('');
}

export class Message {
    role: MessageRole;
    content: string;
    custom?: string;
    local?: boolean;
    streaming: boolean;
    error?: string;
    isError?: boolean;

    private _plan: Plan;
    private _abortController?: AbortController;
    private _onChange?: Notify;

    static user(content: string): Message {
        return new Message({ role: 'user', content });
    }

    static assistant(onChange?: Notify): Message {
        return new Message({ role: 'assistant', onChange });
    }

    static fromJSON(message: MessageJSON, onChange?: Notify): Message {
        const runtime = new Message({
            role: message.role,
            content: message.content,
            onChange,
        });
        runtime.custom = message.custom;
        runtime.local = message.local;
        runtime.streaming = message.streaming === true;
        const plans = message.role === 'assistant' ? message.plans ?? [] : [];
        if (plans[0] !== undefined) {
            runtime._plan = Plan.fromJSON(plans[0], { onChange: () => runtime._notify() });
        } else if (message.role === 'assistant' && !runtime.streaming) {
            runtime._plan.finish(false);
        }
        runtime.error = message.error;
        runtime.isError = message.isError;
        return runtime;
    }

    constructor(options: { role: MessageRole, content?: string, onChange?: Notify }) {
        this.role = options.role;
        this.content = options.content ?? '';
        this.streaming = this.role === 'assistant';
        this._plan = new Plan({ onChange: () => this._notify() });
        this._abortController = undefined;
        this._onChange = options.onChange;
    }

    async generate(
        agent: Agent,
        adapter: Adapter,
        history: Message[],
        options: SendOptions = { signal: null, system: null }
    ): Promise<void> {
        this.content = '';
        this.error = undefined;
        this.isError = false;
        this.streaming = true;
        this._plan = new Plan({ onChange: () => this._notify() });
        this._notify();

        if (this._abortController !== undefined) this._abortController.abort();
        const abortController = new AbortController();
        this._abortController = abortController;
        const signal = options.signal ?? abortController.signal;

        try {
            const compact: CompactOptions | null = agent.config.compactThreshold !== undefined
                ? {
                    threshold: agent.config.compactThreshold,
                    keepTail: agent.config.compactKeepTail ?? 4,
                    compactPrompt: agent.config.compactPrompt ?? null,
                }
                : null;
            await agent.loop({
                adapter,
                history,
                system: options.system ?? agent.config.systemPrompt ?? '',
                signal,
                compact,
                rounds: this._plan.rounds,
                notify: () => this._notify(),
            });

            this._applyFinalContent();
            this._finish();
        } catch (err) {
            if (isAbortError(err)) {
                this._finish();
            } else {
                this._fail(errorMessage(err));
            }
        } finally {
            if (this._abortController === abortController) {
                this._abortController = undefined;
            }
            this._notify();
        }
    }

    stop(): void {
        if (this._abortController !== undefined) this._abortController.abort();
    }

    togglePlan(idx: number): void {
        if (idx === 0) this._plan.toggle();
    }

    get plan(): Plan | null {
        return this.role === 'assistant' ? this._plan : null;
    }

    get plans(): Plan[] {
        if (this.role !== 'assistant') return [];
        if (this.streaming === false && this._plan.rounds.length === 0 && this._plan.status === 'completed') return [];
        return [this._plan];
    }

    toJSON(): MessageJSON {
        const message: MessageJSON = {
            role: this.role,
            content: this.content,
        };
        if (this.custom !== undefined) message.custom = this.custom;
        if (this.local === true) message.local = true;
        if (this.streaming === true) message.streaming = true;
        if (this.error !== undefined) message.error = this.error;
        if (this.isError === true) message.isError = true;
        if (this.role === 'assistant' && this._plan.rounds.length > 0) {
            message.plans = [this._plan.toJSON()];
        }
        return message;
    }

    private _applyFinalContent(): void {
        const finalRound = this._plan.rounds[this._plan.rounds.length - 1];
        if (finalRound === undefined) return;

        const content = getRoundContent(finalRound);
        if (content.length > 0) {
            this.content = content;
            finalRound.removeContentActions();
            if (finalRound.actions.length === 0) {
                this._plan.rounds.pop();
            }
        }
    }

    // 配合这次流式 Round.addAction/touch/replaceActions 改动加的。
    private _syncStreamingContent(): void {
        if (!this.streaming) return;
        const rounds = this._plan.rounds;
        if (rounds.length === 0) return;
        const lastRound = rounds[rounds.length - 1];
        const content = getRoundContent(lastRound);
        if (content.length > 0) this.content = content;
    }

    private _finish(): void {
        this.streaming = false;
        this._plan.finish();
    }

    private _fail(err: string): void {
        this.streaming = false;
        this.error = err;
        this.isError = true;
        this._plan.fail();
    }

    private _notify(): void {
        this._syncStreamingContent();
        if (this._onChange !== undefined) this._onChange();
    }
}
