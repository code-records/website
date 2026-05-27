import { Action, type ActionJSON } from './Action';
import type { ModelResponseStatus } from '../../model/Model';

export interface RoundJSON {
    actions: ActionJSON[];
    done: boolean;
    hasContent?: boolean;
    isActive?: boolean;
    label?: string;
    status?: ModelResponseStatus;
    text?: string;
}

export class Round {
    private readonly _actions: Action[] = [];
    done = false;
    status?: ModelResponseStatus;
    text = '';

    get actions(): readonly Action[] {
        return this._actions;
    }

    get items(): readonly Action[] {
        return this._actions;
    }

    get hasContent(): boolean {
        return this.text.length > 0 || this._actions.some(action => action.text.length > 0);
    }

    get isActive(): boolean {
        return !this.done;
    }

    get label(): string {
        const last = this._actions[this._actions.length - 1];
        return last?.label || '';
    }

    static fromJSON(json: RoundJSON): Round {
        const round = new Round();
        round.text = json.text ?? '';
        round.done = json.done;
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
        if (last.type === 'tool' && action.call === undefined && action.text.length > 0) {
            return false;
        }
        last.text = action.text;
        last.callId = action.callId;
        last.call = action.call;
        last.event = action.event;
        last.label = action.label;
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
        return {
            actions: this._actions.map(action => action.toJSON()),
            done: this.done,
            hasContent: this.hasContent,
            isActive: this.isActive,
            label: this.label,
            status: this.status,
            text: this.text.length > 0 ? this.text : undefined,
        };
    }
}
