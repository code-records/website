import { Step, type StepJSON } from './Step';
import type { ClientStatus } from './type';
import type { ModelResponseType } from '../model/Model';
import type { ToolUsage } from '../tools/tool/Tool';

export interface RoundJSON {
    count: number;
    kind?: 'round';
    label?: string;
    status: ClientStatus;
    steps: StepJSON[];
    text?: string;
    type?: ModelResponseType;
}

export class Round {
    readonly kind = 'round';
    type?: ModelResponseType;
    status: ClientStatus = 'pending';
    count = 0;
    label = '';
    text = '';
    private readonly _steps: Step[] = [];

    get steps(): readonly Step[] {
        return this._steps;
    }

    get toolCount(): number {
        return this._steps.filter(step => step.type === 'tool').length;
    }

    formatLabel(): string {
        const usageLabel = this.formatUsageLabel();
        if (usageLabel.length > 0) return usageLabel;
        if (this.status === 'failed') return '处理失败';
        if (this.status === 'pending') return '正在思考';
        if (this.type === 'final') return '生成了回答';
        if (this.type === 'continue') return '继续生成';
        return '已完成';
    }

    static fromJSON(json: RoundJSON): Round {
        const round = new Round();
        round.count = json.count ?? 0;
        round.text = json.text ?? '';
        round.label = json.label ?? '';
        round.status = json.status;
        round.type = json.type;
        for (const step of json.steps) {
            round.add(Step.fromJSON(step));
        }
        return round;
    }

    appendText(text: string): void {
        this.text += text;
    }

    add(step: Step): void {
        this._steps.push(step);
    }

    appendToLast(type: Step['type'], text: string): boolean {
        const last = this._steps[this._steps.length - 1];
        if (last === undefined || last.type !== type || last.status !== 'pending') {
            return false;
        }
        last.append(text);
        return true;
    }

    updateLast(step: Step): boolean {
        const last = this._steps[this._steps.length - 1];
        if (last === undefined || last.type !== step.type || last.status !== 'pending') {
            return false;
        }
        if (step.type === 'tool') {
            return false;
        }
        last.call = step.call;
        last.callId = step.callId;
        last.event = step.event;
        last.label = step.label || last.label;
        last.text = step.text;
        return true;
    }

    updateTool(step: Step): boolean {
        if (step.type !== 'tool' || step.callId === undefined) {
            return false;
        }

        const existing = this._steps.find(item => item.type === 'tool' && item.callId === step.callId);
        if (existing === undefined) {
            return false;
        }

        existing.call = step.call ?? existing.call;
        existing.callId = step.callId;
        existing.event = step.event ?? existing.event;
        existing.label = step.label || existing.label;
        existing.status = mergeClientStatus(existing.status, step.status);
        existing.text = step.text || existing.text;
        existing.usage = step.usage ?? existing.usage;
        return true;
    }

    updateToolLabel(callId: string, label: string): boolean {
        const existing = this._steps.find(item => item.type === 'tool' && item.callId === callId);
        if (existing === undefined) {
            return false;
        }
        existing.label = label;
        return true;
    }

    updateToolUsage(callId: string, usage: ToolUsage): boolean {
        const existing = this._steps.find(item => item.type === 'tool' && item.callId === callId);
        if (existing === undefined) {
            return false;
        }
        existing.usage = usage;
        return true;
    }

    complete(type = this.type): void {
        this.type = type;
        this.status = 'completed';
        for (const step of this._steps) {
            step.finish();
        }
    }

    fail(): void {
        this.status = 'failed';
        for (const step of this._steps) {
            step.finish();
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
            steps: this._steps.map(step => step.toJSON()),
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
                const prefix = this.status === 'completed' ? `${verb}了` : `正在${verb} `;
                return `${prefix}${verbGroups.map(formatUsageGroup).join('、')}`;
            })
            .join('；');
    }

    private collectUsageGroups(): UsageGroup[] {
        const groups = new Map<string, UsageGroup>();
        for (const step of this._steps) {
            if (step.type !== 'tool' || step.usage === undefined) continue;
            const usage = step.usage;
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
