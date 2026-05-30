import type { AgentEvent } from '../../core/type';

export interface TraceEntry {
    event: AgentEvent;
    index: number;
    timestamp: number;
}

export class Trace {
    private readonly entries: TraceEntry[] = [];

    add(event: AgentEvent, timestamp = Date.now()): TraceEntry {
        const entry = {
            event,
            index: this.entries.length,
            timestamp,
        };
        this.entries.push(entry);
        return entry;
    }

    snapshot(): readonly TraceEntry[] {
        return this.entries;
    }

    clear(): void {
        this.entries.length = 0;
    }
}
