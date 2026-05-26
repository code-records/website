import type { JsonObject } from '../tools/tool/Tool';

export interface ParseSseOptions {
    idleTimeout?: number;
    signal?: AbortSignal;
}

interface ReadResult {
    done?: boolean;
    value?: Uint8Array;
}

export async function* parseSseStream(
    response: Response,
    { idleTimeout = 0, signal }: ParseSseOptions = {},
): AsyncGenerator<JsonObject, void, void> {
    if (!response.body) {
        throw new Error('Response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await readChunk(reader, { idleTimeout, signal });
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() ?? '';

            for (const event of events) {
                yield* parseSseEvent(event);
            }
        }
    } finally {
        reader.releaseLock();
    }

    if (buffer.trim()) {
        yield* parseSseEvent(buffer);
    }
}

async function readChunk(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    { idleTimeout, signal }: Required<Pick<ParseSseOptions, 'idleTimeout'>> & Pick<ParseSseOptions, 'signal'>,
): Promise<ReadResult> {
    const readPromise = reader.read();
    if (idleTimeout <= 0 && signal === undefined) {
        return readPromise;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;

    return Promise.race([
        readPromise,
        ...(idleTimeout > 0
            ? [new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('Stream idle timeout')), idleTimeout);
            })]
            : []),
        ...(signal
            ? [new Promise<never>((_, reject) => {
                abortHandler = () => reject(new DOMException('Aborted', 'AbortError'));
                if (signal.aborted) abortHandler();
                signal.addEventListener('abort', abortHandler, { once: true });
            })]
            : []),
    ]).finally(() => {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
        if (signal !== undefined && abortHandler !== undefined) {
            signal.removeEventListener('abort', abortHandler);
        }
    });
}

function* parseSseEvent(event: string): Generator<JsonObject, void, void> {
    const lines = event.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        const parsed = parseJsonObject(data);
        if (parsed !== null) {
            yield parsed;
        }
    }
}

function parseJsonObject(value: string): JsonObject | null {
    try {
        const parsed: unknown = JSON.parse(value);
        return isJsonObject(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function isJsonObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
