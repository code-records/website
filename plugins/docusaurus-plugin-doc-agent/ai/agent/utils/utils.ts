import type { ToolInput, UnknownRecord } from '../types';

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function safeParse(str: unknown): ToolInput {
    try {
        const parsed = JSON.parse(typeof str === 'string' ? str : '{}');
        return isRecord(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

interface ParseSseOptions {
    idleTimeout?: number;
    signal?: AbortSignal;
}

interface ReadResult {
    done?: boolean;
    value?: Uint8Array;
}

function isReadResult(value: unknown): value is ReadResult {
    if (!isRecord(value)) return false;
    return value.done !== undefined || value.value instanceof Uint8Array;
}

export async function* parseSseStream(response: Response, { idleTimeout = 0, signal }: ParseSseOptions = {}): AsyncGenerator<UnknownRecord, void, void> {
    if (!response.body) throw new Error('Response body is empty');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const readPromise = reader.read();
            let result: ReadResult;

            if (idleTimeout > 0) {
                let timeoutId: ReturnType<typeof setTimeout> | undefined;
                let abortHandler: (() => void) | undefined;
                const raced = await Promise.race([
                    readPromise,
                    new Promise((_, reject) => {
                        timeoutId = setTimeout(() => reject(new Error('Stream idle timeout')), idleTimeout);
                    }),
                    ...(signal ? [new Promise((_, reject) => {
                        abortHandler = () => reject(new DOMException('Aborted', 'AbortError'));
                        if (signal.aborted) abortHandler();
                        signal.addEventListener('abort', abortHandler, { once: true });
                    })] : []),
                ]).finally(() => {
                    if (timeoutId !== undefined) clearTimeout(timeoutId);
                    if (signal && abortHandler !== undefined) signal.removeEventListener('abort', abortHandler);
                });
                result = isReadResult(raced) ? raced : {};
            } else {
                result = await readPromise;
            }

            const { done, value } = result;
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() || '';

            for (const event of events) {
                const lines = event.split(/\r?\n/).filter(Boolean);
                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const data = line.slice(5).trim();
                    if (!data || data === '[DONE]') continue;
                    try {
                        yield JSON.parse(data);
                    } catch { }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    if (buffer.trim()) {
        for (const line of buffer.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data && data !== '[DONE]') {
                try {
                    yield JSON.parse(data);
                } catch { }
            }
        }
    }
}
