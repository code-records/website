import type { JsonObject, JsonValue } from '../tools/tool/Tool';

export function isJsonObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function requireJsonObject(value: unknown, context: string): JsonObject {
    if (isJsonObject(value)) return value;
    throw new Error(`${context} must be an object`);
}

export function requireString(value: unknown, context: string): string {
    if (typeof value === 'string') return value;
    throw new Error(`${context} must be a string`);
}

export function optionalString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

export function optionalArray(value: unknown): JsonValue[] {
    return Array.isArray(value) ? value as JsonValue[] : [];
}

export function safeParseJsonObject(value: string): JsonObject {
    try {
        const parsed: unknown = JSON.parse(value);
        return isJsonObject(parsed) ? parsed : {};
    } catch {
        return {};
    }
}
