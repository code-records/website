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
    private readonly rounds: Round[] = [];
    expanded = false;
    status: PlanStatus = 'active';

    get items(): readonly Round[] {
        return this.rounds;
    }

    get hasContent(): boolean {
        return this.rounds.some(round => round.hasContent);
    }

    get isActive(): boolean {
        return this.status === 'active';
    }

    get label(): string {
        const last = this.rounds[this.rounds.length - 1];
        return last?.label || (this.status === 'completed' ? '分析完毕' : '正在工作');
    }

    static fromJSON(json: PlanJSON): Plan {
        const plan = new Plan();
        plan.expanded = json.expanded === true;
        plan.status = json.status;
        for (const round of json.rounds) {
            plan.rounds.push(Round.fromJSON(round));
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

        const action = Action.fromAgentEvent(event);
        if (action === null) return;

        const round = this.ensureRound();
        if ((action.type === 'content' || action.type === 'thinking') && round.appendToLast(action.type, action.content)) {
            return;
        }
        round.add(action);
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
            rounds: this.rounds.map(round => round.toJSON()),
            status: this.status,
        };
    }

    private ensureRound(): Round {
        const last = this.rounds[this.rounds.length - 1];
        if (last !== undefined && !last.done) {
            return last;
        }
        const round = new Round();
        this.rounds.push(round);
        return round;
    }

    private finishOpenRound(): void {
        const last = this.rounds[this.rounds.length - 1];
        if (last !== undefined) {
            last.finish();
        }
    }
}
