import { Action, type ActionJSON } from './Action';
import type { ClientStatus } from './Plan';
import type { ModelResponseType } from '../../model/Model';
import type { ToolUsage } from '../../tools/tool/Tool';

export interface RoundJSON {
    actions: ActionJSON[];
    count: number;
    kind?: 'round';
    label?: string;
    status: ClientStatus;
    text?: string;
    type?: ModelResponseType;
}

export class Round {
    /** Stable discriminator for UI rendering and persistence. */
    readonly kind = 'round';
    /** Model response type for this round: tool calls, continuation, or final answer. */
    type?: ModelResponseType;
    /** Client lifecycle state shared with Plan and Action. */
    status: ClientStatus = 'pending';
    /** 1-based round index within the current agent run. */
    count = 0;
    /** Optional explicit display label; empty means formatLabel() derives it. */
    label = '';
    /** Text emitted directly by the model during this round. */
    text = '';
    /** Display actions collected from model events and tool events. */
    private readonly _actions: Action[] = [];

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
        const usageLabel = this.formatUsageLabel();
        if (usageLabel.length > 0) return usageLabel;
        if (this.status === 'failed') return '\u5904\u7406\u5931\u8d25';
        if (this.status === 'pending') return '\u6b63\u5728\u601d\u8003';
        if (this.type === 'final') return '\u751f\u6210\u4e86\u56de\u7b54';
        if (this.type === 'continue') return '\u7ee7\u7eed\u751f\u6210';
        return '\u5df2\u5b8c\u6210';
    }

    static fromJSON(json: RoundJSON): Round {
        const round = new Round();
        round.count = json.count ?? 0;
        round.text = json.text ?? '';
        round.label = json.label ?? '';
        round.status = json.status;
        round.type = json.type;
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
        if (last === undefined || last.type !== type || last.status !== 'pending') {
            return false;
        }
        last.append(text);
        return true;
    }

    updateLast(action: Action): boolean {
        const last = this._actions[this._actions.length - 1];
        if (last === undefined || last.type !== action.type || last.status !== 'pending') {
            return false;
        }
        if (action.type === 'tool') {
            return false;
        }
        last.call = action.call;
        last.callId = action.callId;
        last.event = action.event;
        last.label = action.label || last.label;
        last.text = action.text;
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

        existing.call = action.call ?? existing.call;
        existing.callId = action.callId;
        existing.event = action.event ?? existing.event;
        existing.label = action.label || existing.label;
        existing.status = mergeClientStatus(existing.status, action.status);
        existing.text = action.text || existing.text;
        existing.usage = action.usage ?? existing.usage;
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

    updateToolUsage(callId: string, usage: ToolUsage): boolean {
        const existing = this._actions.find(item => item.type === 'tool' && item.callId === callId);
        if (existing === undefined) {
            return false;
        }
        existing.usage = usage;
        return true;
    }

    complete(type = this.type): void {
        this.type = type;
        this.status = 'completed';
        for (const action of this._actions) {
            action.finish();
        }
    }

    fail(): void {
        this.status = 'failed';
        for (const action of this._actions) {
            action.finish();
        }
    }

    toJSON(): RoundJSON {
        const label = this.label || this.formatLabel();
        return {
            kind: this.kind,
            type: this.type,
            status: this.status,
            count: this.count,
            label,
            text: this.text.length > 0 ? this.text : undefined,
            actions: this._actions.map(action => action.toJSON()),
        };
    }

    private formatUsageLabel(): string {
        const groups = this.collectUsageGroups();
        if (groups.length === 0) return '';

        const byVerb = new Map<string, UsageGroup[]>();
        for (const group of groups) {
            const verbGroups = byVerb.get(group.verb) ?? [];
            verbGroups.push(group);
            byVerb.set(group.verb, verbGroups);
        }

        return Array.from(byVerb.entries())
            .map(([verb, verbGroups]) => {
                const prefix = this.status === 'completed' ? `${verb}\u4e86` : `\u6b63\u5728${verb} `;
                return `${prefix}${verbGroups.map(formatUsageGroup).join('\u3001')}`;
            })
            .join('\uff1b');
    }

    private collectUsageGroups(): UsageGroup[] {
        const groups = new Map<string, UsageGroup>();
        for (const action of this._actions) {
            if (action.type !== 'tool' || action.usage === undefined) continue;
            const usage = action.usage;
            if (!isCountableUsage(usage)) continue;

            const groupKey = `${usage.verb}\u0000${usage.name}\u0000${usage.unit}`;
            const group = groups.get(groupKey) ?? {
                count: 0,
                keyedCount: 0,
                keys: new Set<string>(),
                name: usage.name,
                unit: usage.unit,
                verb: usage.verb,
            };

            if (usage.key !== undefined && usage.key.length > 0) {
                group.keys.add(usage.key);
                group.keyedCount = group.keys.size;
            } else {
                group.count += normalizeUsageCount(usage.count);
            }

            groups.set(groupKey, group);
        }
        return Array.from(groups.values());
    }
}

interface UsageGroup {
    count: number;
    keyedCount: number;
    keys: Set<string>;
    name: string;
    unit: string;
    verb: string;
}

function formatUsageGroup(group: UsageGroup): string {
    const total = group.count + group.keyedCount;
    return total > 0 ? `${total} ${group.unit}${group.name}` : group.name;
}

function isCountableUsage(usage: ToolUsage): boolean {
    return usage.verb.length > 0 && usage.name.length > 0 && usage.unit.length > 0;
}

function normalizeUsageCount(count: number | undefined): number {
    if (typeof count !== 'number' || !Number.isFinite(count)) return 1;
    return Math.max(0, Math.floor(count));
}

function mergeClientStatus(current: ClientStatus, next: ClientStatus): ClientStatus {
    if (current === 'failed' || next === 'failed') return 'failed';
    if (current === 'completed' || next === 'completed') return 'completed';
    return 'pending';
}
