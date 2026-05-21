import { estimateMessagesTokens } from '../tokenEstimator';
import {
    DEFAULT_COMPACT_SUMMARY_PROMPT,
    compactPlanProtocol,
    compactSummaryProtocol,
    describeMessage,
    describeRange,
} from './protocol';
import { logger } from '../../utils/logger';
import type {
    AdapterMessageList,
    Adapter,
    AdapterMessage,
    CompactOptions,
    CompactResult,
    LogData,
    UnknownRecord,
} from '../../types';

const MAX_PLAN_MESSAGE_PREVIEW = 360;
const MAX_PLAN_CANDIDATES = 8;

export function shouldCompact(messages: AdapterMessageList, { threshold }: CompactOptions): boolean {
    return estimateMessagesTokens(messages) > threshold;
}

interface CompactMessagesIfNeededOptions {
    adapter: Adapter;
    compact: CompactOptions | null;
    meta: LogData;
    signal: AbortSignal | null;
    system: string;
}

export async function compactMessagesIfNeeded(
    messages: AdapterMessageList,
    {
        adapter,
        compact,
        meta,
        signal,
        system,
    }: CompactMessagesIfNeededOptions
): Promise<AdapterMessageList | null> {
    if (compact === null) return null;

    logger('agent.loop.compact.start', { ...meta, messageCount: messages.length });
    const result = await compactMessages(messages, adapter, compact, { system, signal });
    if (result.compacted) {
        logger('agent.loop.compact.end', { ...meta, ...(result.stats ?? {}) });
        return result.messages;
    } else {
        logger('agent.loop.compact.skip', meta);
        return null;
    }
}

interface CompactMessagesContext {
    signal: AbortSignal | null;
    system: string;
}

export async function compactMessages(messages: AdapterMessageList, adapter: Adapter, {
    threshold,
    keepTail,
    compactPrompt,
}: CompactOptions, { signal }: CompactMessagesContext): Promise<CompactResult> {
    const totalTokens = estimateMessagesTokens(messages);

    const plan = await planCompaction(messages, adapter, { threshold, keepTail }, { signal });
    const range = plan.status === 'compact'
        ? plan.range
        : plan.status === 'failed' && totalTokens > threshold
            ? fallbackCompactRange(messages, keepTail, adapter)
            : null;
    if (range === null) return { messages, compacted: false };

    const toSummarize = messages.slice(range.startIndex, range.endIndex) as AdapterMessageList;
    const before = messages.slice(0, range.startIndex) as AdapterMessageList;
    const after = messages.slice(range.endIndex) as AdapterMessageList;

    const summaryResult = await compactSummaryProtocol.run({
        messages: toSummarize,
        prompt: compactPrompt ?? DEFAULT_COMPACT_SUMMARY_PROMPT,
    }, { adapter, signal });
    if (summaryResult.error !== undefined) return { messages, compacted: false, error: summaryResult.error };
    const summary = summaryResult.output ?? '';
    if (summary.length === 0) return { messages, compacted: false };

    const compactedMessages = [
        ...before,
        adapter.createUserMsg(`[Previous conversation summary]\n${summary}`),
        adapter.createAssistantTextMsg('Understood. I have the context from our previous conversation.'),
        ...after,
    ] as AdapterMessageList;

    return {
        messages: compactedMessages,
        compacted: true,
        stats: {
            beforeTokens: totalTokens,
            afterTokens: estimateMessagesTokens(compactedMessages),
            compactedStartIndex: range.startIndex,
            compactedEndIndex: range.endIndex,
            summarizedCount: toSummarize.length,
            keptCount: before.length + after.length,
        },
    };
}

interface CompactRange {
    endIndex: number;
    id?: string;
    startIndex: number;
}

interface CandidateRange extends CompactRange {
    id: string;
    tokenEstimate: number;
}

interface CompactPlanContext {
    signal: AbortSignal | null;
}

type CompactPlanResult =
    | { status: 'compact'; range: CompactRange }
    | { status: 'none' }
    | { status: 'failed' };

async function planCompaction(
    messages: AdapterMessageList,
    adapter: Adapter,
    { threshold, keepTail }: Pick<CompactOptions, 'threshold' | 'keepTail'>,
    { signal }: CompactPlanContext
): Promise<CompactPlanResult> {
    const candidates = buildCandidateRanges(messages, keepTail, adapter);
    if (candidates.length === 0) return { status: 'none' };

    const result = await compactPlanProtocol.run({
        candidates: candidates.map(candidate => ({
            id: candidate.id,
            startIndex: candidate.startIndex,
            endIndex: candidate.endIndex,
            messageCount: candidate.endIndex - candidate.startIndex,
            tokenEstimate: candidate.tokenEstimate,
            kind: describeRange(messages, candidate),
        })),
        keepTail,
        messageCount: messages.length,
        messages: messages.map((message, index) => ({
            index,
            kind: describeMessage(message),
            preview: previewMessage(message),
            protected: index >= Math.max(0, messages.length - keepTail),
            provider: message.provider,
            tokens: estimateMessagesTokens([message] as AdapterMessageList),
        })),
        threshold,
        totalTokens: estimateMessagesTokens(messages),
    }, { adapter, signal });

    if (result.error !== undefined) {
        logger('agent.loop.compact.plan.error', {
            error: result.error instanceof Error ? result.error.message : String(result.error),
        });
        return { status: 'failed' };
    }

    const selected = result.output;
    if (selected === null) return { status: 'failed' };
    if (selected.action !== 'compact') return { status: 'none' };

    const candidate = candidates.find(item =>
        item.id === selected.rangeId
        && item.startIndex === selected.startIndex
        && item.endIndex === selected.endIndex
    );
    if (candidate === undefined) return { status: 'failed' };
    if (!isValidCompactRange(messages, candidate, keepTail, adapter)) return { status: 'failed' };
    return { status: 'compact', range: candidate };
}

function fallbackCompactRange(messages: AdapterMessageList, keepTail: number, adapter: Adapter): CompactRange | null {
    const splitIndex = findSafeSplitIndex(messages, keepTail, adapter);
    if (splitIndex <= 0) return null;
    return { startIndex: 0, endIndex: splitIndex };
}

function buildCandidateRanges(messages: AdapterMessageList, keepTail: number, adapter: Adapter): CandidateRange[] {
    const protectedStart = Math.max(0, messages.length - keepTail);
    const boundaries = [
        0,
        ...collectSafeBoundaries(messages, protectedStart, adapter),
    ];
    const candidates: Array<Omit<CandidateRange, 'id'>> = [];

    for (let startIdx = 0; startIdx < boundaries.length - 1; startIdx++) {
        for (let endIdx = startIdx + 1; endIdx < boundaries.length; endIdx++) {
            const startIndex = boundaries[startIdx];
            const endIndex = boundaries[endIdx];
            if (endIndex <= startIndex || endIndex > protectedStart) continue;
            const slice = messages.slice(startIndex, endIndex) as AdapterMessageList;
            candidates.push({
                startIndex,
                endIndex,
                tokenEstimate: estimateMessagesTokens(slice),
            });
        }
    }

    return candidates
        .sort((a, b) =>
            b.tokenEstimate - a.tokenEstimate
            || a.startIndex - b.startIndex
            || b.endIndex - a.endIndex
        )
        .slice(0, MAX_PLAN_CANDIDATES)
        .map((candidate, index) => ({
            ...candidate,
            id: `r${index + 1}`,
        }));
}

function collectSafeBoundaries(messages: AdapterMessageList, maxIndex: number, adapter: Adapter): number[] {
    const boundaries: number[] = [];
    for (let i = 1; i <= maxIndex; i++) {
        if (isTurnBoundary(messages, i, adapter)) boundaries.push(i);
    }
    return boundaries;
}

function isValidCompactRange(
    messages: AdapterMessageList,
    { startIndex, endIndex }: CompactRange,
    keepTail: number,
    adapter: Adapter
): boolean {
    const protectedStart = Math.max(0, messages.length - keepTail);
    if (endIndex <= startIndex || endIndex > protectedStart) return false;
    if (startIndex !== 0 && !isTurnBoundary(messages, startIndex, adapter)) return false;
    return isTurnBoundary(messages, endIndex, adapter);
}

function previewMessage(message: AdapterMessage): string {
    const text = stringifyMessage(message);
    return text.length > MAX_PLAN_MESSAGE_PREVIEW
        ? `${text.slice(0, MAX_PLAN_MESSAGE_PREVIEW)}...`
        : text;
}

function stringifyMessage(message: AdapterMessage): string {
    try {
        return JSON.stringify(message.payload);
    } catch {
        return String(message.payload ?? '');
    }
}

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function findSafeSplitIndex(messages: AdapterMessageList, keepTail: number, adapter: Adapter): number {
    const earliest = messages.length - keepTail;
    if (earliest <= 0) return 0;

    for (let i = earliest; i >= 1; i--) {
        if (isTurnBoundary(messages, i, adapter)) return i;
    }

    return 0;
}

function isTurnBoundary(messages: AdapterMessageList, index: number, adapter: Adapter): boolean {
    const current = messages[index];
    if (current === undefined) return false;
    return isUserMessage(current) && isSafeBoundary(messages, index, adapter);
}

function isUserMessage(message: AdapterMessage): boolean {
    const payload = isRecord(message.payload) ? message.payload : {};
    return payload.role === 'user';
}

function isSafeBoundary(messages: AdapterMessageList, index: number, adapter: Adapter): boolean {
    if (index <= 0) return false;

    const previous = messages[index - 1];
    const current = messages[index];
    if (previous === undefined || current === undefined) return false;

    return adapter.isSafeCompactBoundary(previous, current);
}
