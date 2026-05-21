import { Action } from './Action';
import type { ActionJSON, Notify, RoundJSON } from '../types';

interface RoundOptions {
    actions?: Array<Action | ActionJSON>;
    isActive?: boolean;
    onChange?: Notify;
}

export class Round {
    private _actions: Action[];
    private _active: boolean;
    private _onChange?: Notify;

    constructor({ actions, isActive, onChange }: RoundOptions = {}) {
        this._actions = (actions ?? []).map(action => action instanceof Action ? action : new Action(action));
        this._active = isActive ?? true;
        this._onChange = onChange;
    }

    static fromActions(actions: Action[], onChange?: Notify): Round {
        return new Round({ actions, onChange });
    }

    static fromJSON(json: RoundJSON, onChange?: Notify): Round {
        return new Round({
            actions: json.actions,
            isActive: json.isActive,
            onChange,
        });
    }

    get isActive(): boolean {
        return this._active;
    }

    get actions(): Action[] {
        return this._actions;
    }

    get actionCount(): number {
        return this._actions.length;
    }

    get hasContent(): boolean {
        return this.isActive === true || this._actions.length > 0;
    }

    get label(): string {
        if (this._active) return '正在工作...';
        return `已完成 ${this.actionCount} 步操作`;
    }

    removeContentActions(): void {
        this._actions = this._actions.filter(action => action.type !== 'content');
        this._notify();
    }

    // 流式输出 新增一个 action
    addAction(action: Action): void {
        this._actions.push(action);
        this._notify();
    }

    // 流式输出 action 对象内部变了，通知刷新
    touch(): void {
        this._notify();
    }

    // 流式输出 整批替换 actions
    replaceActions(actions: Action[]): void {
        this._actions = actions;
        this._notify();
    }

    finish(): void {
        this._active = false;
        for (const action of this._actions) {
            if (action.type !== 'tool') action.done = true;
        }
        this._notify();
    }

    toJSON(): RoundJSON {
        const actions = this._actions
            .map(action => action.toJSON())
            .filter(action =>
                (action.label !== undefined && action.label.length > 0)
                || (action.content !== undefined && action.content.length > 0)
                || action.call !== undefined
            );

        return {
            actions,
            label: this.label,
            isActive: this.isActive,
            hasContent: this.hasContent,
        };
    }

    private _notify(): void {
        if (this._onChange !== undefined) this._onChange();
    }
}
