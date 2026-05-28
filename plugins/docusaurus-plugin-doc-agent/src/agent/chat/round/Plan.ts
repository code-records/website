import type { AgentEvent } from '../../Agent';
import { Action } from './Action';
import { Round, type RoundJSON } from './Round';

export type PlanStatus = 'active' | 'completed' | 'failed';

export interface PlanJSON {
    expanded?: boolean;
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

    get text(): string {
        return this._rounds
            .filter(round => round.status === 'final' || round.status === 'continue')
            .map(round => round.text)
            .filter(text => text.length > 0)
            .join('');
    }

    formatLabel(): string {
        const toolCount = this._rounds.reduce((count, round) => count + round.toolCount, 0);
        if (toolCount > 0) return `工作 ${toolCount} 步`;
        return this.status === 'completed' ? '分析完毕' : '正在工作';
    }

    get currentRound(): Round | undefined {
        return this._rounds[this._rounds.length - 1];
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

    apply(event: AgentEvent): Round | null {
        if (event.type === 'agent_error') {
            const round = this.ensureRound();
            const action = Action.fromAgentEvent(event) as Action;
            round.add(action);
            this.status = 'failed';
            this.finishOpenRound();
            return round;
        }

        if (event.type === 'agent_done') {
            this.status = 'completed';
            this.finishOpenRound();
            return this.currentRound ?? null;
        }

        if (event.type === 'model_event' && event.event.type === 'content') {
            const round = this.ensureModelRound();
            round.appendText(event.event.content);
            return round;
        }

        if (event.type === 'model_event' && event.event.type === 'done') {
            const round = this.ensureModelRound();
            round.status = event.event.response.responseStatus;
            return round;
        }

        const action = Action.fromAgentEvent(event);
        if (action === null) return null;

        const round = event.type === 'model_event' ? this.ensureModelRound() : this.ensureRound();
        if (event.type === 'model_event' && event.event.type === 'action' && event.event.kind === 'update') {
            if (round.updateLast(action)) return round;
        }
        if (action.type === 'thinking' && round.appendToLast(action.type, action.text)) {
            return round;
        }
        if (action.type === 'tool' && round.updateTool(action)) {
            return round;
        }
        round.add(action);
        return round;
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
