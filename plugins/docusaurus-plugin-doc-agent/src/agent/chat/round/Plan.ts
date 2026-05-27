import type { AgentEvent } from '../../Agent';
import { Action } from './Action';
import { Round, type RoundJSON } from './Round';

export type PlanStatus = 'active' | 'completed' | 'failed';

export interface PlanJSON {
    expanded?: boolean;
    hasContent?: boolean;
    isActive?: boolean;
    label?: string;
    rounds: RoundJSON[];
    status: PlanStatus;
}

export class Plan {
    private readonly _rounds: Round[] = [];
    expanded = false;
    status: PlanStatus = 'active';

    get rounds(): readonly Round[] {
        return this._rounds;
    }

    get items(): readonly Round[] {
        return this._rounds;
    }

    get hasContent(): boolean {
        return this._rounds.some(round => round.hasContent);
    }

    get text(): string {
        return this._rounds
            .filter(round => round.status === 'final' || round.status === 'continue')
            .map(round => round.text)
            .filter(text => text.length > 0)
            .join('');
    }

    get isActive(): boolean {
        return this.status === 'active';
    }

    get label(): string {
        const last = this._rounds[this._rounds.length - 1];
        return last?.label || (this.status === 'completed' ? '分析完毕' : '正在工作');
    }

    static fromJSON(json: PlanJSON): Plan {
        const plan = new Plan();
        plan.expanded = json.expanded === true;
        plan.status = json.status;
        for (const round of json.rounds) {
            plan._rounds.push(Round.fromJSON(round));
        }
        return plan;
    }

    apply(event: AgentEvent): void {
        if (event.type === 'agent_error') {
            this.ensureRound().add(Action.fromAgentEvent(event) as Action);
            this.status = 'failed';
            this.finishOpenRound();
            return;
        }

        if (event.type === 'agent_done') {
            this.status = 'completed';
            this.finishOpenRound();
            return;
        }

        if (event.type === 'model_event' && event.event.type === 'content') {
            this.ensureModelRound().appendText(event.event.content);
            return;
        }

        if (event.type === 'model_event' && event.event.type === 'done') {
            this.ensureModelRound().status = event.event.response.status;
            return;
        }

        const action = Action.fromAgentEvent(event);
        if (action === null) return;

        const round = event.type === 'model_event' ? this.ensureModelRound() : this.ensureRound();
        if (event.type === 'model_event' && event.event.type === 'action' && event.event.kind === 'update') {
            if (round.updateLast(action)) return;
        }
        if (action.type === 'thinking' && round.appendToLast(action.type, action.text)) {
            return;
        }
        round.add(action);
    }

    appendUserText(text: string): void {
        const round = this.ensureRound();
        round.appendText(text);
        round.status = 'final';
    }

    finish(): void {
        this.status = 'completed';
        this.finishOpenRound();
    }

    toggle(): void {
        this.expanded = !this.expanded;
    }

    toJSON(): PlanJSON {
        return {
            expanded: this.expanded,
            hasContent: this.hasContent,
            isActive: this.isActive,
            label: this.label,
            rounds: this._rounds.map(round => round.toJSON()),
            status: this.status,
        };
    }

    private ensureRound(): Round {
        const last = this._rounds[this._rounds.length - 1];
        if (last !== undefined && !last.done) {
            return last;
        }
        const round = new Round();
        this._rounds.push(round);
        return round;
    }

    private ensureModelRound(): Round {
        const last = this._rounds[this._rounds.length - 1];
        if (last !== undefined && !last.done && last.status !== undefined) {
            last.finish();
        }
        return this.ensureRound();
    }

    private finishOpenRound(): void {
        const last = this._rounds[this._rounds.length - 1];
        if (last !== undefined) {
            last.finish();
        }
    }
}
