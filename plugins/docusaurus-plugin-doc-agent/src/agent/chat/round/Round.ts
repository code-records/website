import { Action, type ActionJSON } from './Action';
import type { ModelResponseKind } from '../../model/Model';

export interface RoundJSON {
    actions: ActionJSON[];
    count: number;
    done: boolean;
    kind?: 'round';
    label?: string;
    status?: ModelResponseKind;
    text?: string;
}

export class Round {
    private readonly _actions: Action[] = [];
    count = 0;
    done = false;
    readonly kind = 'round';
    label = '';
    status?: ModelResponseKind;
    text = '';

    get actions(): readonly Action[] {
        return this._actions;
    }

    get items(): readonly Action[] {
        return this._actions;
    }

    get toolCount(): number {
        return this._actions.filter(action => action.type === 'tool').length;
    }

    formatLabel(): string {
        if (this.toolCount > 0) return `工作 ${this.toolCount} 步`;
        if (this.status === 'final') return '回复';
        if (this.status === 'continue') return '继续';
        if (this.status === 'tool_calls') return '工作 0 步';
        return this.done ? '已完成' : '正在工作';
    }

    static fromJSON(json: RoundJSON): Round {
        const round = new Round();
        round.count = json.count ?? 0;
        round.text = json.text ?? '';
        round.done = json.done;
        round.label = json.label ?? '';
        round.status = json.status;
        for (const action of json.actions) {
            round.add(Action.fromJSON(action));
        }
        return round;
    }

    appendText(text: string): void {
        this.text += text;
    }

    add(action: Action): void {
        this._actions.push(action);
    }

    appendToLast(type: Action['type'], text: string): boolean {
        const last = this._actions[this._actions.length - 1];
        if (last === undefined || last.type !== type || last.done) {
            return false;
        }
        last.append(text);
        return true;
    }

    updateLast(action: Action): boolean {
        const last = this._actions[this._actions.length - 1];
        if (last === undefined || last.type !== action.type || last.done) {
            return false;
        }
        if (action.type === 'tool') {
            return false;
        }
        last.text = action.text;
        last.callId = action.callId;
        last.call = action.call;
        last.event = action.event;
        last.label = action.label || last.label;
        return true;
    }

    updateTool(action: Action): boolean {
        if (action.type !== 'tool' || action.callId === undefined) {
            return false;
        }

        const existing = this._actions.find(item => item.type === 'tool' && item.callId === action.callId);
        if (existing === undefined) {
            return false;
        }

        existing.callId = action.callId;
        existing.call = action.call ?? existing.call;
        existing.done = existing.done || action.done;
        existing.event = action.event ?? existing.event;
        existing.label = action.label || existing.label;
        existing.text = action.text || existing.text;
        return true;
    }

    updateToolLabel(callId: string, label: string): boolean {
        const existing = this._actions.find(item => item.type === 'tool' && item.callId === callId);
        if (existing === undefined) {
            return false;
        }
        existing.label = label;
        return true;
    }

    finish(status = this.status): void {
        this.status = status;
        this.done = true;
        for (const action of this._actions) {
            action.finish();
        }
    }

    toJSON(): RoundJSON {
        const label = this.label || this.formatLabel();
        return {
            kind: this.kind,
            count: this.count,
            done: this.done,
            label,
            status: this.status,
            text: this.text.length > 0 ? this.text : undefined,
            actions: this._actions.map(action => action.toJSON()),
        };
    }
}

