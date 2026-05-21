import type { AdapterMessageList, UnknownRecord } from '../types';

/**
 * Lightweight token estimator for browser runtime without tiktoken.
 *
 * Estimation rules:
 * - Latin letters, numbers, and punctuation: about 4 chars = 1 token
 * - CJK chars: about 1.5 chars = 1 token
 * - Mixed text is estimated proportionally
 */

const CJK_RANGE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function estimateTokens(text: string): number {
    if (!text) return 0;
    const cjkChars = text.match(CJK_RANGE)?.length || 0;
    const otherChars = text.length - cjkChars;
    return Math.ceil(otherChars / 4 + cjkChars / 1.5);
}

export function estimateMessagesTokens(messages: AdapterMessageList): number {
    let total = 0;
    for (const message of messages) {
        const msg = isRecord(message.payload) ? message.payload : {};
        total += 4; // message overhead (role, separators)
        const content = msg.content;
        if (typeof content === 'string') {
            total += estimateTokens(content);
        } else if (Array.isArray(content)) {
            for (const value of content) {
                const block = isRecord(value) ? value : {};
                if (block.type === 'text') total += estimateTokens(String(block.text || ''));
                else if (block.type === 'tool_use') total += estimateTokens(JSON.stringify(block.input)) + 10;
                else if (block.type === 'tool_result') total += estimateTokens(typeof block.content === 'string' ? block.content : JSON.stringify(block.content));
                else if (block.type === 'input_text' || block.type === 'output_text') total += estimateTokens(String(block.text || ''));
            }
        }
        if (typeof msg.name === 'string') total += estimateTokens(msg.name);
        if (typeof msg.arguments === 'string') total += estimateTokens(msg.arguments);
        if (msg.input !== undefined) total += estimateTokens(JSON.stringify(msg.input));
        if (msg.output !== undefined) total += estimateTokens(typeof msg.output === 'string' ? msg.output : JSON.stringify(msg.output));
    }
    return total;
}
