import { AgentResult, type AgentResultJSON } from '../core/AgentResult';
import type { ClientStatus } from '../core/type';

export interface FlowJSON {
    count: number;
    expanded?: boolean;
    input: string;
    kind?: 'flow';
    label?: string;
    result?: AgentResultJSON;
    status: ClientStatus;
}

export interface FlowOptions {
    input: string;
    label?: string;
}

export class Flow {
    readonly kind = 'flow';
    count = 0;
    expanded = false;
    input: string;
    label = '';
    result?: AgentResult;
    status: ClientStatus = 'pending';

    constructor(options: FlowOptions) {
        this.input = options.input;
        this.label = options.label ?? '';
    }

    start(result: AgentResult): void {
        this.result = result;
        this.status = 'pending';
    }

    formatLabel(): string {
        if (this.label.length > 0) return this.label;
        return `执行 ${this.count}`;
    }

    finish(): void {
        this.status = 'completed';
    }

    fail(): void {
        this.status = 'failed';
    }

    toggle(): void {
        this.expanded = !this.expanded;
    }

    static fromJSON(json: FlowJSON): Flow {
        const flow = new Flow({
            input: json.input ?? '',
            label: json.label ?? '',
        });
        flow.count = json.count ?? 0;
        flow.expanded = json.expanded === true;
        flow.status = json.status;
        flow.result = json.result !== undefined ? AgentResult.fromJSON(json.result) : undefined;
        return flow;
    }

    toJSON(): FlowJSON {
        const result = this.result?.toJSON();
        return {
            kind: this.kind,
            count: this.count,
            expanded: this.expanded,
            input: this.input,
            label: this.label,
            status: this.status,
            ...(result !== undefined ? { result } : {}),
        };
    }
}
