import { Action, type ActionJSON } from './Action';

export interface RoundJSON {
    actions: ActionJSON[];
    done: boolean;
    hasContent?: boolean;
    isActive?: boolean;
    label?: string;
}

export class Round {
    private readonly _actions: Action[] = [];
    done = false;

    get actions(): readonly Action[] {
        return this._actions;
    }

    get items(): readonly Action[] {
        return this._actions;
    }

    get hasContent(): boolean {
        return this._actions.some(action => action.content.length > 0);
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
        round.done = json.done;
        for (const action of json.actions) {
            round.add(Action.fromJSON(action));
        }
        return round;
    }

    add(action: Action): void {
        this._actions.push(action);
    }

    appendToLast(type: Action['type'], content: string): boolean {
        const last = this._actions[this._actions.length - 1];
        if (last === undefined || last.type !== type || last.done) {
            return false;
        }
        last.append(content);
        return true;
    }

    updateLast(action: Action): boolean {
        const last = this._actions[this._actions.length - 1];
        if (last === undefined || last.type !== action.type || last.done) {
            return false;
        }
        if (last.type === 'tool' && action.call === undefined && action.content.length > 0) {
            return false;
        }
        last.content = action.content;
        last.callId = action.callId;
        last.call = action.call;
        last.event = action.event;
        last.label = action.label;
        return true;
    }

    finish(): void {
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
        };
    }
}
