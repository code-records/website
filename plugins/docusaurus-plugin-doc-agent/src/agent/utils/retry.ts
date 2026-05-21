export interface RetryOptions {
    maxRetries?: number;
    signal?: AbortSignal;
}

export type RetryCallback<T> = (signal?: AbortSignal) => Promise<T>;

export async function withRetry<T>(
    fn: RetryCallback<T>,
    { maxRetries = 2, signal }: RetryOptions = {},
): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        try {
            return await fn(signal);
        } catch (error) {
            const err = toError(error);
            lastError = err;

            if (isAbortError(err)) {
                throw err;
            }
            if (!isRetryable(err)) {
                throw err;
            }
            if (attempt === maxRetries) {
                break;
            }

            await sleep(getBackoff(attempt), signal);
        }
    }

    throw lastError ?? new Error('Retry failed');
}

function isRetryable(error: Error): boolean {
    const status = errorStatus(error);
    if (status === 429) return true;
    if (status >= 500) return true;
    if (status > 0 && status < 500) return false;

    const message = error.message;
    if (message.includes('fetch') || message.includes('network') || message.includes('Failed')) {
        return true;
    }
    return true;
}

function errorStatus(error: Error): number {
    const candidate = error as Error & { status?: number };
    return typeof candidate.status === 'number' ? candidate.status : 0;
}

function isAbortError(error: Error): boolean {
    return error.name === 'AbortError';
}

function getBackoff(attempt: number): number {
    const base = 1000;
    const delay = base * 2 ** attempt;
    return delay + delay * 0.3 * Math.random();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }

        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
