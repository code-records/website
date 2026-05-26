import type { Message } from '../chat/Message';
import { isJsonObject } from './json';

const CJK_RANGE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;

export function estimateTokens(text: string): number {
    if (text.length === 0) return 0;
    const cjkChars = text.match(CJK_RANGE)?.length ?? 0;
    const otherChars = text.length - cjkChars;
    return Math.ceil(otherChars / 4 + cjkChars / 1.5);
}

export function estimateContextTokens(context: readonly Message[]): number {
    let total = 0;
    for (const message of context) {
        total += 4;
        total += estimateMessagePayloadTokens(message);
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
