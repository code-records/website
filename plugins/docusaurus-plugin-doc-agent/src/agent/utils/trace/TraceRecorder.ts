import { Trace } from './Trace';
import type { AgentEvent } from '../../core/type';

export interface TraceRecorder {
    record(event: AgentEvent): void;
}

export class InMemoryTraceRecorder implements TraceRecorder {
    readonly trace: Trace;

    constructor(trace = new Trace()) {
        this.trace = trace;
    }

    record(event: AgentEvent): void {
        this.trace.add(event);
    }
}
