import { Context } from '../../core/Context';
import type { ContextPatch } from './Tool';

export function applyContextPatch(context: Context, patch: ContextPatch): Context {
    if (patch.type === 'append') {
        const next = context.clone();
        next.merge(patch.context);
        return next;
    }
    if (patch.type === 'replace' || patch.type === 'compact') {
        return patch.context.clone();
    }
    return context.clone();
}

export function mergeContextPatches(
    baseContext: Context,
    patches: readonly ContextPatch[],
): ContextPatch | undefined {
    if (patches.length === 0) {
        return undefined;
    }

    if (patches.every(patch => patch.type === 'append')) {
        const context = new Context();
        for (const patch of patches) {
            context.merge(patch.context);
        }
        return {
            context,
            type: 'append',
        };
    }

    let finalContext = baseContext.clone();
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
