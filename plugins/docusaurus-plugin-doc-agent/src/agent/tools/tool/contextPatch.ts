import type { Message } from '../../chat/Message';
import type { ContextPatch } from './Tool';

export function applyContextPatch(messages: readonly Message[], patch: ContextPatch): Message[] {
    if (patch.type === 'append') {
        return [...messages, ...patch.context];
    }
    if (patch.type === 'replace' || patch.type === 'compact') {
        return [...patch.context];
    }
    return [...messages];
}

export function mergeContextPatches(
    baseContext: readonly Message[],
    patches: readonly ContextPatch[],
): ContextPatch | undefined {
    if (patches.length === 0) {
        return undefined;
    }

    if (patches.every(patch => patch.type === 'append')) {
        return {
            context: patches.flatMap(patch => patch.context),
            type: 'append',
        };
    }

    let finalContext = [...baseContext];
    let compactSummary: string | undefined;
    let hasCompact = false;

    for (const patch of patches) {
        finalContext = applyContextPatch(finalContext, patch);
        if (patch.type === 'compact') {
            hasCompact = true;
            compactSummary = patch.summary;
        }
    }

    if (hasCompact) {
        return {
            context: finalContext,
            ...(compactSummary !== undefined ? { summary: compactSummary } : {}),
            type: 'compact',
        };
    }

    return {
        context: finalContext,
        type: 'replace',
    };
}
