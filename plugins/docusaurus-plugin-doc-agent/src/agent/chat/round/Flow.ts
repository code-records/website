import type { AgentEvent } from '../../Agent';
import { Action } from './Action';
import { Round, type RoundJSON } from './Round';

export type ClientStatus = 'pending' | 'completed' | 'failed';

export interface FlowJSON {
    count: number;
    expanded?: boolean;
    input?: string;
    kind?: 'flow';
    label?: string;
    rounds: RoundJSON[];
    status: ClientStatus;
}

export interface FlowOptions {
    input?: string;
    label?: string;
}

export class Flow {
    readonly kind = 'flow';
    status: ClientStatus = 'pending';
    count = 0;
    label = '';
    input = '';
    expanded = false;
    private readonly _rounds: Round[] = [];

    constructor(options: FlowOptions = {}) {
        this.input = options.input ?? '';
        this.label = options.label ?? '';
    }

    get rounds(): readonly Round[] {
        return this._rounds;
    }

    get items(): readonly Round[] {
        return this._rounds;
    }

    get text(): string {
        return this._rounds
            .filter(round => round.type === 'final' || round.type === 'continue')
            .map(round => round.text)
            .filter(text => text.length > 0)
            .join('');
    }

    formatLabel(): string {
        if (this.label.length > 0) return this.label;
        return `执行 ${this.count}`;
    }

    get currentRound(): Round | undefined {
        return this._rounds[this._rounds.length - 1];
    }

    static fromJSON(json: FlowJSON): Flow {
        const flow = new Flow();
        flow.count = json.count ?? 0;
        flow.expanded = json.expanded === true;
        flow.input = json.input ?? '';
        flow.label = json.label ?? '';
        flow.status = json.status;
        for (const round of json.rounds) {
            flow._rounds.push(Round.fromJSON(round));
        }
        return flow;
    }

    apply(event: AgentEvent): Round | null {
        if (event.type === 'agent_error') {
            const round = this.ensureRound();
            const action = Action.fromAgentEvent(event) as Action;
            round.add(action);
            this.status = 'failed';
            this.failOpenRound();
            return round;
        }

        if (event.type === 'agent_done') {
            this.status = 'completed';
            this.completeOpenRound();
            return this.currentRound ?? null;
        }

        if (event.type === 'model_event' && event.event.type === 'content') {
            const round = this.ensureModelRound();
            round.appendText(event.event.content);
            return round;
        }

        if (event.type === 'model_event' && event.event.type === 'done') {
            const round = this.ensureModelRound();
            round.type = event.event.response.responseStatus;
            return round;
        }

        const action = Action.fromAgentEvent(event);
        if (action === null) return null;

        const round = event.type === 'model_event' ? this.ensureModelRound() : this.ensureRound();
        if (action.type === 'tool') {
            if (round.updateTool(action)) return round;
            round.add(action);
            return round;
        }
        if (event.type === 'model_event' && event.event.type === 'action' && event.event.kind === 'update') {
            if (round.updateLast(action)) return round;
        }
        if (action.type === 'thinking' && round.appendToLast(action.type, action.text)) {
            return round;
        }
        round.add(action);
        return round;
    }

    appendUserText(text: string): void {
        const round = this.ensureRound();
        round.appendText(text);
        round.type = 'final';
    }

    finish(): void {
        this.status = 'completed';
        this.completeOpenRound();
    }

    toggle(): void {
        this.expanded = !this.expanded;
    }

    toJSON(): FlowJSON {
        return {
            kind: this.kind,
            status: this.status,
            count: this.count,
            input: this.input,
            label: this.label,
            expanded: this.expanded,
            rounds: this._rounds.map(round => round.toJSON()),
        };
    }

    private ensureRound(): Round {
        const last = this._rounds[this._rounds.length - 1];
        if (last !== undefined && last.status === 'pending') {
            return last;
        }
        const round = new Round();
        this._rounds.push(round);
        return round;
    }

    private ensureModelRound(): Round {
        const last = this._rounds[this._rounds.length - 1];
        if (last !== undefined && last.status === 'pending' && last.type !== undefined) {
            last.complete();
        }
        return this.ensureRound();
    }

    private completeOpenRound(): void {
        const last = this._rounds[this._rounds.length - 1];
        if (last !== undefined) {
            last.complete();
        }
    }

    private failOpenRound(): void {
        const last = this._rounds[this._rounds.length - 1];
        if (last !== undefined) {
            last.fail();
        }
    }
}
