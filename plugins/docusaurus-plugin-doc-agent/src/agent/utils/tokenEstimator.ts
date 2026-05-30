import type { Context } from '../core/Context';
import { isJsonObject } from './json';

const CJK_RANGE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;

export function estimateTokens(text: string): number {
    if (text.length === 0) return 0;
    const cjkChars = text.match(CJK_RANGE)?.length ?? 0;
    const otherChars = text.length - cjkChars;
    return Math.ceil(otherChars / 4 + cjkChars / 1.5);
}

export function estimateContextTokens(context: Context): number {
    let total = 0;
    if (context.summary.length > 0) {
        total += estimateTokens(context.summary);
    }
    for (const message of context.messages) {
        total += 4;
        total += estimateTokens(message.role);
        total += estimateTokens(message.content);
        if (message.result !== undefined) {
            total += estimateMessagePayloadTokens(message.result.toJSON());
        }
    }
    return total;
}

function estimateMessagePayloadTokens(payload: unknown): number {
    if (typeof payload === 'string') {
        return estimateTokens(payload);
    }
    if (Array.isArray(payload)) {
        return payload.reduce((sum, item) => sum + estimateMessagePayloadTokens(item), 0);
    }
    if (!isJsonObject(payload)) {
        return 0;
    }

    let total = 0;
    for (const [key, value] of Object.entries(payload)) {
        total += estimateTokens(key);
        if (typeof value === 'string') {
            total += estimateTokens(value);
        } else if (Array.isArray(value) || isJsonObject(value)) {
            total += estimateMessagePayloadTokens(value);
        } else if (value !== null) {
            total += estimateTokens(String(value));
        }
    }
    return total;
}
