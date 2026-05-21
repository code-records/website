import { Round } from './Round';
import type { Notify, PlanJSON, PlanStatus } from '../types';

interface PlanOptions {
    onChange?: Notify;
}

export class Plan {
    private _rounds: Round[];
    private _status: PlanStatus;
    private _expanded: boolean;
    private _onChange?: Notify;

    constructor({ onChange }: PlanOptions = {}) {
        this._rounds = [];
        this._status = 'active';
        this._expanded = true;
        this._onChange = onChange;
    }

    static fromJSON(json: PlanJSON, { onChange }: PlanOptions = {}): Plan {
        const plan = new Plan({ onChange });
        plan._rounds = (json.rounds ?? []).map(round => new Round({
            actions: round.actions,
            isActive: round.isActive,
            onChange: () => plan._notify(),
        }));
        plan._status = json.status ?? 'completed';
        plan._expanded = json.expanded ?? false;
        return plan;
    }

    get status(): PlanStatus {
        return this._status;
    }

    get rounds(): Round[] {
        return this._rounds;
    }

    get expanded(): boolean {
        return this._expanded;
    }

    get isActive(): boolean {
        return this._status === 'active';
    }

    get actionCount(): number {
        return this._rounds.reduce((sum, round) => sum + round.actionCount, 0);
    }

    get hasContent(): boolean {
        return this.isActive === true || this.rounds.some(round => round.hasContent);
    }

    get label(): string {
        if (this._status === 'failed') return '分析异常';
        if (this.isActive) return '正在工作...';
        return `已完成 ${this.actionCount} 步操作`;
    }

    finish(collapse = true): void {
        const round = this._rounds[this._rounds.length - 1];
        if (round !== undefined) round.finish();
        this._status = 'completed';
        if (collapse) this._expanded = false;
        this._notify();
    }

    fail(): void {
        const round = this._rounds[this._rounds.length - 1];
        if (round !== undefined) round.finish();
        this._status = 'failed';
        this._expanded = false;
        this._notify();
    }

    toggle(): void {
        this._expanded = !this._expanded;
        this._notify();
    }

    toJSON(): PlanJSON {
        const rounds = this.rounds.map(round => round.toJSON());

        return {
            expanded: this.expanded,
            label: this.label,
            status: this.status,
            isActive: this.isActive,
            hasContent: this.hasContent,
            rounds,
        };
    }

    private _notify(): void {
        if (this._onChange !== undefined) this._onChange();
    }
}
