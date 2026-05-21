/**
 * Request retry with exponential backoff.
 *
 * Browser network jitter is common; automatically retry 429, 5xx, and network errors.
 * Do not retry aborts, parameter errors, or non-429 4xx responses.
 */

interface RetryOptions {
    maxRetries?: number;
    signal?: AbortSignal;
}

interface RetryCallback<T> {
    (signal?: AbortSignal): Promise<T>;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function errorStatus(error: unknown): number {
    if (error !== null && typeof error === 'object' && 'status' in error) {
        const status = (error as { status: unknown }).status;
        return typeof status === 'number' ? status : 0;
    }
    return 0;
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

export async function withRetry<T>(fn: RetryCallback<T>, { maxRetries = 2, signal }: RetryOptions = {}): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        try {
            return await fn(signal);
        } catch (e) {
            lastError = e;
            if (isAbortError(e)) throw e;
            if (!isRetryable(e)) throw e;
            if (attempt === maxRetries) break;
            await sleep(getBackoff(attempt), signal);
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function withRetryStream<T>(fn: RetryCallback<T>, { maxRetries = 2, signal }: RetryOptions = {}): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        try {
            return fn(signal);
        } catch (e) {
            lastError = e;
            if (isAbortError(e)) throw e;
            if (!isRetryable(e)) throw e;
            if (attempt === maxRetries) break;
            await sleep(getBackoff(attempt), signal);
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRetryable(e: unknown): boolean {
    const status = errorStatus(e);
    const message = errorMessage(e);
    if (status === 429) return true;
    if (status && status >= 500) return true;
    if (status && status < 500 && status !== 429) return false;
    if (message.includes('fetch') || message.includes('network') || message.includes('Failed')) return true;
    return true;
}

function getBackoff(attempt: number): number {
    const base = 1000;
    const delay = base * Math.pow(2, attempt);
    const jitter = delay * 0.3 * Math.random();
    return delay + jitter;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
}
