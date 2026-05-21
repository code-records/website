import { History, type HistoryJSON } from './History';
import type { MessageJSON } from './Message';
import type { ActionJSON, ActionType } from './round/Action';
import type { PlanJSON, PlanStatus } from './round/Plan';
import type { RoundJSON } from './round/Round';
import type { ToolCall } from '../model/Model';
import type { JsonObject, JsonValue, ToolEvent } from '../tools/Tool';

export interface SessionMeta {
    [key: string]: string | number | boolean | null;
}

export interface SessionData {
    history: HistoryJSON;
    meta: SessionMeta;
}

export interface SessionListItem {
    key: string;
    messageCount: number;
    meta: SessionMeta;
}

export interface SessionStoreOptions {
    maxAgeMs?: number;
    maxSessions?: number;
    prefix?: string;
    storage?: Storage | null;
}

export class SessionStore {
    private readonly maxAgeMs: number;
    private readonly maxSessions: number;
    private readonly prefix: string;
    private readonly storage: Storage | null;

    constructor({
        maxAgeMs = 7 * 24 * 60 * 60 * 1000,
        maxSessions = 20,
        prefix = 'agent_session:',
        storage = getDefaultStorage(),
    }: SessionStoreOptions = {}) {
        this.maxAgeMs = maxAgeMs;
        this.maxSessions = maxSessions;
        this.prefix = prefix;
        this.storage = storage;
    }

    save(key: string, history: History, meta: SessionMeta = {}): void {
        if (this.storage === null) return;

        const data: SessionData = {
            history: history.toJSON(),
            meta: {
                ...meta,
                updatedAt: Date.now(),
            },
        };

        try {
            this.storage.setItem(this.toStorageKey(key), JSON.stringify(data));
        } catch (error) {
            if (!isQuotaExceededError(error)) return;
            this.prune();
            try {
                this.storage.setItem(this.toStorageKey(key), JSON.stringify(data));
            } catch {
                // Ignore storage failures. Session persistence is best-effort.
            }
        }
    }

    load(key: string): SessionData | null {
        if (this.storage === null) return null;

        try {
            const raw = this.storage.getItem(this.toStorageKey(key));
            if (raw === null) return null;
            const parsed: unknown = JSON.parse(raw);
            return parseSessionData(parsed);
        } catch {
            return null;
        }
    }

    loadHistory(key: string): History | null {
        const data = this.load(key);
        return data === null ? null : History.fromJSON(data.history);
    }

    delete(key: string): void {
        this.storage?.removeItem(this.toStorageKey(key));
    }

    clear(): void {
        if (this.storage === null) return;

        for (const key of this.keys()) {
            this.storage.removeItem(key);
        }
    }

    list(): SessionListItem[] {
        if (this.storage === null) return [];

        const items: SessionListItem[] = [];
        for (const storageKey of this.keys()) {
            const key = storageKey.slice(this.prefix.length);
            const data = this.load(key);
            if (data === null) continue;

            items.push({
                key,
                messageCount: data.history.messages.length,
                meta: data.meta,
            });
        }

        return items.sort((a, b) => Number(b.meta.updatedAt ?? 0) - Number(a.meta.updatedAt ?? 0));
    }

    prune(): void {
        if (this.storage === null) return;

        const now = Date.now();
        for (const item of this.list()) {
            const updatedAt = Number(item.meta.updatedAt ?? 0);
            if (updatedAt > 0 && now - updatedAt > this.maxAgeMs) {
                this.delete(item.key);
            }
        }

        for (const item of this.list().slice(this.maxSessions)) {
            this.delete(item.key);
        }
    }

    private keys(): string[] {
        if (this.storage === null) return [];

        const keys: string[] = [];
        for (let index = 0; index < this.storage.length; index++) {
            const key = this.storage.key(index);
            if (key?.startsWith(this.prefix)) {
                keys.push(key);
            }
        }
        return keys;
    }

    private toStorageKey(key: string): string {
        return `${this.prefix}${key}`;
    }
}

function parseSessionData(value: unknown): SessionData | null {
    if (!isRecord(value)) return null;
    const history = parseHistory(value.history);
    if (history === null) return null;

    return {
        history,
        meta: parseMeta(value.meta),
    };
}

function parseHistory(value: unknown): HistoryJSON | null {
    if (!isRecord(value) || !Array.isArray(value.messages)) {
        return null;
    }

    return {
        messages: value.messages
            .map(parseMessage)
            .filter(message => message !== null),
    };
}

function parseMessage(value: unknown): MessageJSON | null {
    if (!isRecord(value)) return null;

    const content = typeof value.content === 'string' ? value.content : '';
    const role = value.role === 'assistant' ? 'assistant' : 'user';
    const plan = parsePlan(value.plan);

    return {
        content,
        ...(plan !== null ? { plan } : {}),
        role,
    };
}

function parsePlan(value: unknown): PlanJSON | null {
    if (!isRecord(value) || !Array.isArray(value.rounds)) return null;

    return {
        rounds: value.rounds
            .map(parseRound)
            .filter(round => round !== null),
        status: parsePlanStatus(value.status),
    };
}

function parseRound(value: unknown): RoundJSON | null {
    if (!isRecord(value) || !Array.isArray(value.actions)) return null;

    return {
        actions: value.actions
            .map(parseAction)
            .filter(action => action !== null),
        done: value.done === true,
    };
}

function parseAction(value: unknown): ActionJSON | null {
    if (!isRecord(value)) return null;
    const type = parseActionType(value.type);
    if (type === null) return null;

    const call = parseToolCall(value.call);
    const event = parseToolEvent(value.event);
    const content = typeof value.content === 'string' ? value.content : undefined;
    const label = typeof value.label === 'string' ? value.label : undefined;

    return {
        ...(call !== null ? { call } : {}),
        ...(content !== undefined ? { content } : {}),
        done: value.done === true,
        ...(event !== null ? { event } : {}),
        ...(label !== undefined ? { label } : {}),
        type,
    };
}

function parseToolCall(value: unknown): ToolCall | null {
    if (!isRecord(value)) return null;
    const input = parseJsonObject(value.input);
    if (typeof value.id !== 'string' || typeof value.name !== 'string' || input === null) {
        return null;
    }

    const result = parseJsonValue(value.result);
    return {
        id: value.id,
        input,
        name: value.name,
        ...(result !== undefined ? { result } : {}),
    };
}

function parseToolEvent(value: unknown): ToolEvent | null {
    if (!isRecord(value) || typeof value.type !== 'string') return null;
    const data = parseJsonObject(value.data);
    return {
        ...(data !== null ? { data } : {}),
        type: value.type,
    };
}

function parsePlanStatus(value: unknown): PlanStatus {
    if (value === 'completed' || value === 'failed') {
        return value;
    }
    return 'active';
}

function parseActionType(value: unknown): ActionType | null {
    if (
        value === 'content'
        || value === 'context'
        || value === 'error'
        || value === 'thinking'
        || value === 'tool'
    ) {
        return value;
    }
    return null;
}

function parseMeta(value: unknown): SessionMeta {
    if (!isRecord(value)) return {};

    const meta: SessionMeta = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null) {
            meta[key] = item;
        }
    }
    return meta;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(value: unknown): JsonObject | null {
    const parsed = parseJsonValue(value);
    return isJsonObject(parsed) ? parsed : null;
}

function parseJsonValue(value: unknown): JsonValue | undefined {
    if (
        value === null
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
    ) {
        return value;
    }

    if (Array.isArray(value)) {
        const items: JsonValue[] = [];
        for (const item of value) {
            const parsed = parseJsonValue(item);
            if (parsed === undefined) return undefined;
            items.push(parsed);
        }
        return items;
    }

    if (isRecord(value)) {
        const record: JsonObject = {};
        for (const [key, item] of Object.entries(value)) {
            const parsed = parseJsonValue(item);
            if (parsed !== undefined) {
                record[key] = parsed;
            }
        }
        return record;
    }

    return undefined;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
    return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isQuotaExceededError(error: unknown): boolean {
    return error instanceof Error && error.name === 'QuotaExceededError';
}

function getDefaultStorage(): Storage | null {
    return globalThis.localStorage ?? null;
}
