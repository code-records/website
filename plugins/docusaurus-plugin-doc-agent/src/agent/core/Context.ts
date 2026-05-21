import type { ModelMessage } from '../model/Model';
import type { ContextPatch } from '../tools/Tool';
import { ContextError } from '../utils/errors';

export type ContextChangeType = 'append' | 'replace' | 'compact';

export interface ContextChange {
    after: readonly ModelMessage[];
    before: readonly ModelMessage[];
    patch: ContextPatch;
    summary?: string;
    type: ContextChangeType;
}

export class Context {
    private messages: ModelMessage[];

    constructor(initial: readonly ModelMessage[] = []) {
        this.messages = [...initial];
    }

    snapshot(): readonly ModelMessage[] {
        return [...this.messages];
    }

    toModelMessages(): ModelMessage[] {
        return [...this.messages];
    }

    append(messages: readonly ModelMessage[]): ContextChange {
        return this.apply({
            type: 'append',
            context: [...messages],
        });
    }

    replace(messages: readonly ModelMessage[]): ContextChange {
        return this.apply({
            type: 'replace',
            context: [...messages],
        });
    }

    compact(messages: readonly ModelMessage[], summary?: string): ContextChange {
        return this.apply({
            type: 'compact',
            context: [...messages],
            summary,
        });
    }

    apply(patch: ContextPatch): ContextChange {
        const before = this.snapshot();

        if (patch.type === 'append') {
            this.messages.push(...patch.context);
        } else if (patch.type === 'replace' || patch.type === 'compact') {
            this.messages = [...patch.context];
        } else {
            throw new ContextError(`Unsupported context patch type: ${String((patch as ContextPatch).type)}`);
        }

        return {
            after: this.snapshot(),
            before,
            patch,
            summary: patch.type === 'compact' ? patch.summary : undefined,
            type: patch.type,
        };
    }
}
