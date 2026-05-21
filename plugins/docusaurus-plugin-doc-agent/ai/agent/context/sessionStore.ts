import type { MessageJSON, MessageJSONList, SessionLoadResult, SessionList, UnknownRecord } from '../types';

const STORAGE_PREFIX = 'agent_session:';
const MAX_SESSIONS = 20;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isQuotaExceededError(error: unknown): boolean {
    return error instanceof Error && error.name === 'QuotaExceededError';
}

export function saveSession(key: string, messages: MessageJSONList, meta: UnknownRecord = {}): void {
    const data = {
        messages: messages.map(stripNonSerializable),
        meta: { ...meta, updatedAt: Date.now() },
    };

    try {
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
    } catch (e) {
        if (isQuotaExceededError(e)) {
            pruneOldSessions();
            try {
                localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
            } catch { /* ignore */ }
        }
    }
}

export function loadSession(key: string): SessionLoadResult {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + key);
        if (!raw) return null as unknown as SessionLoadResult;
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed)) return null as unknown as SessionLoadResult;
        const messages = Array.isArray(parsed.messages) ? parsed.messages as MessageJSONList : [];
        const meta = isRecord(parsed.meta) ? parsed.meta : {};
        return {
            messages,
            meta,
        };
    } catch {
        return null as unknown as SessionLoadResult;
    }
}

export function deleteSession(key: string): void {
    localStorage.removeItem(STORAGE_PREFIX + key);
}

export function listSessions(): SessionList {
    const sessions: SessionList = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(STORAGE_PREFIX)) continue;

        try {
            const raw = localStorage.getItem(k);
            const parsed = raw ? JSON.parse(raw) : {};
            const data = isRecord(parsed) ? parsed : {};
            const meta = isRecord(data.meta) ? data.meta : {};
            const messages = Array.isArray(data.messages) ? data.messages : [];
            sessions.push({
                key: k.slice(STORAGE_PREFIX.length),
                meta,
                messageCount: messages.length,
            });
        } catch { /* skip corrupt */ }
    }

    return sessions.sort((a, b) => (Number(b.meta.updatedAt) || 0) - (Number(a.meta.updatedAt) || 0)) as SessionList;
}

export function clearAllSessions(): void {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
}

function pruneOldSessions(): void {
    const sessions = listSessions();
    const now = Date.now();

    for (const s of sessions) {
        if (now - (Number(s.meta.updatedAt) || 0) > MAX_AGE_MS) {
            deleteSession(s.key);
        }
    }

    const remaining = listSessions();
    if (remaining.length > MAX_SESSIONS) {
        const toDelete = remaining.slice(MAX_SESSIONS);
        toDelete.forEach(s => deleteSession(s.key));
    }
}

function stripNonSerializable(msg: MessageJSON): MessageJSON {
    const { role, content, plans, isError } = msg;
    const clean: MessageJSON = { role, content };
    if (isError) clean.isError = true;
    if (role === 'assistant' && plans?.length) {
        clean.plans = plans.map(plan => ({
            expanded: plan.expanded,
            hasContent: plan.hasContent,
            isActive: plan.isActive,
            label: plan.label,
            status: plan.status,
            rounds: plan.rounds?.map(round => ({
                hasContent: round.hasContent,
                isActive: round.isActive,
                label: round.label,
                actions: round.actions,
            })),
        })) as MessageJSON['plans'];
    }
    return clean;
}
