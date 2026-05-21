import { ModelProtocol } from '../../core/modelProtocol';
import type {
    Adapter,
    AdapterChatResponse,
    AdapterMessage,
    AdapterMessageList,
    UnknownRecord,
} from '../../types';

export interface CompactPlanPromptCandidate {
    endIndex: number;
    id: string;
    kind: string;
    messageCount: number;
    startIndex: number;
    tokenEstimate: number;
}

export interface CompactPlanPromptMessage {
    index: number;
    kind: string;
    preview: string;
    protected: boolean;
    provider: string;
    tokens: number;
}

export interface CompactPlanInput {
    candidates: CompactPlanPromptCandidate[];
    keepTail: number;
    messageCount: number;
    messages: CompactPlanPromptMessage[];
    threshold: number;
    totalTokens: number;
}

export interface CompactPlanOutput {
    action: 'compact' | 'none';
    endIndex?: number;
    rangeId?: string;
    startIndex?: number;
}

export interface CompactSummaryInput {
    messages: AdapterMessageList;
    prompt: string;
}

export const DEFAULT_COMPACT_SUMMARY_PROMPT = `Summarize the conversation above concisely in the same language the user used. Preserve:
- Key facts, decisions, and results
- Tool call outcomes (what was found/read)
- Unanswered questions or pending tasks
Output only the summary, no preamble.`;

export class CompactPlanProtocol extends ModelProtocol<CompactPlanInput, CompactPlanOutput> {
    readonly name = 'compact.plan';

    build(input: CompactPlanInput, adapter: Adapter) {
        return {
            messages: [adapter.createUserMsg(buildCompactPlanPrompt(input))],
            system: '',
            tools: [],
        };
    }

    parse(content: string): CompactPlanOutput | null {
        const json = extractJsonObject(content);
        if (json === null) return null;

        try {
            const parsed: unknown = JSON.parse(json);
            if (!isRecord(parsed)) return null;
            if (parsed.action === 'none') return { action: 'none' };
            if (parsed.action !== 'compact') return null;
            if (typeof parsed.rangeId !== 'string') return null;
            if (typeof parsed.startIndex !== 'number') return null;
            if (typeof parsed.endIndex !== 'number') return null;
            return {
                action: 'compact',
                rangeId: parsed.rangeId,
                startIndex: parsed.startIndex,
                endIndex: parsed.endIndex,
            };
        } catch {
            return null;
        }
    }
}

export class CompactSummaryProtocol extends ModelProtocol<CompactSummaryInput, string> {
    readonly name = 'compact.summary';

    build({ messages, prompt }: CompactSummaryInput, adapter: Adapter) {
        return {
            messages: [
                ...messages,
                adapter.createUserMsg(prompt),
            ],
            system: '',
            tools: [],
        };
    }

    parse(content: string, _response: AdapterChatResponse): string | null {
        const summary = content.trim();
        return summary.length > 0 ? summary : null;
    }
}

export const compactPlanProtocol = new CompactPlanProtocol();
export const compactSummaryProtocol = new CompactSummaryProtocol();

export function describeRange(messages: AdapterMessageList, range: { startIndex: number; endIndex: number }): string {
    const first = messages[range.startIndex];
    const last = messages[range.endIndex - 1];
    return `${describeMessage(first)}..${describeMessage(last)}`;
}

export function describeMessage(message: AdapterMessage | undefined): string {
    if (message === undefined) return 'unknown';
    const payload = isRecord(message.payload) ? message.payload : {};
    const role = typeof payload.role === 'string' ? payload.role : '';
    const type = typeof payload.type === 'string' ? payload.type : '';
    if (role || type) return [role, type].filter(Boolean).join(':');
    return message.provider;
}

function buildCompactPlanPrompt({
    candidates,
    keepTail,
    messageCount,
    messages,
    threshold,
    totalTokens,
}: CompactPlanInput): string {
    return `You are the conversation compaction planner.

Decide whether the current conversation history should be compacted before the next assistant response.

Rules:
- Choose "none" when the useful context should remain fully visible.
- Choose "compact" only when one listed candidate range is old enough or verbose enough to summarize safely.
- You must choose from the candidate ranges exactly; do not invent a range.
- Never compact protected tail messages. The newest ${keepTail} messages are protected.
- Do not split tool call / tool result chains.
- Prefer preserving recent instructions, unresolved tasks, and details the user may still ask about.
- If compacting, choose the range with the best balance of token reduction and low risk.

Return JSON only, with no markdown:
{"action":"none","reason":"short reason"}
or
{"action":"compact","rangeId":"r1","startIndex":0,"endIndex":10,"reason":"short reason"}

Index convention:
- startIndex is inclusive.
- endIndex is exclusive.

Conversation metadata:
${JSON.stringify({ messageCount, totalTokens, threshold, keepTail }, null, 2)}

Candidate ranges:
${JSON.stringify(candidates, null, 2)}

Message inventory:
${JSON.stringify(messages, null, 2)}`;
}

function extractJsonObject(content: string): string | null {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return content.slice(start, end + 1);
}

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
