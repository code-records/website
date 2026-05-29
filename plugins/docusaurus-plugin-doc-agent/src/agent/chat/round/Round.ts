import { Action, type ActionJSON } from './Action';
import type { ModelResponseKind } from '../../model/Model';
import type { ToolActivity } from '../../tools/tool/Tool';

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
        const activityLabel = this.formatActivityLabel();
        if (activityLabel.length > 0) return activityLabel;
        if (this.status === 'continue') return '继续';
        if (this.status === 'final') return '结果';
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
        existing.activity = action.activity ?? existing.activity;
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

    updateToolActivity(callId: string, activity: ToolActivity): boolean {
        const existing = this._actions.find(item => item.type === 'tool' && item.callId === callId);
        if (existing === undefined) {
            return false;
        }
        existing.activity = activity;
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

    private formatActivityLabel(): string {
        const groups = this.collectActivityGroups();
        if (groups.length === 0) return '';

        const byVerb = new Map<string, ActivityGroup[]>();
        for (const group of groups) {
            const verbGroups = byVerb.get(group.verb) ?? [];
            verbGroups.push(group);
            byVerb.set(group.verb, verbGroups);
        }

        return Array.from(byVerb.entries())
            .map(([verb, verbGroups]) => {
                const prefix = this.done ? `${verb}了 ` : `正在${verb} `;
                return `${prefix}${verbGroups.map(formatActivityGroup).join('、')}`;
            })
            .join('，');
    }

    private collectActivityGroups(): ActivityGroup[] {
        const groups = new Map<string, ActivityGroup>();
        for (const action of this._actions) {
            if (action.type !== 'tool' || action.activity === undefined) continue;
            const activity = action.activity;
            if (!isCountableActivity(activity)) continue;

            const groupKey = `${activity.verb}\u0000${activity.name}\u0000${activity.unit}`;
            const group = groups.get(groupKey) ?? {
                count: 0,
                keyedCount: 0,
                keys: new Set<string>(),
                name: activity.name,
                unit: activity.unit,
                verb: activity.verb,
            };

            if (activity.key !== undefined && activity.key.length > 0) {
                group.keys.add(activity.key);
                group.keyedCount = group.keys.size;
            } else {
                group.count += normalizeActivityCount(activity.count);
            }

            groups.set(groupKey, group);
        }
        return Array.from(groups.values());
    }
}

interface ActivityGroup {
    count: number;
    keyedCount: number;
    keys: Set<string>;
    name: string;
    unit: string;
    verb: string;
}

function formatActivityGroup(group: ActivityGroup): string {
    const total = group.count + group.keyedCount;
    return total > 0 ? `${total} ${group.unit}${group.name}` : group.name;
}

function isCountableActivity(activity: ToolActivity): boolean {
    return activity.verb.length > 0 && activity.name.length > 0 && activity.unit.length > 0;
}

function normalizeActivityCount(count: number | undefined): number {
    if (typeof count !== 'number' || !Number.isFinite(count)) return 1;
    return Math.max(0, Math.floor(count));
}
