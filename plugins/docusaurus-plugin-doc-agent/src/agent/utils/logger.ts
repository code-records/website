import type { JsonObject } from '../tools/tool/Tool';

export interface Logger {
    (event: string, data?: JsonObject | null): void;
}

let enabled = false;
let sink: (message: string) => void = message => globalThis.console?.log?.(message);

export function setLogger(debug: boolean, nextSink?: (message: string) => void): void {
    enabled = debug;
    if (nextSink !== undefined) {
        sink = nextSink;
    }
}

export const logger: Logger = (event, data = null) => {
    if (!enabled) return;

    const timestamp = formatTimestamp(new Date());
    const parts = [`[${timestamp}] ${event}`];

    if (data !== null) {
        for (const [key, value] of Object.entries(data)) {
            if (value === undefined || value === null) continue;
            if (Array.isArray(value)) {
                parts.push(`${key}=[${value.length}]`);
            } else if (typeof value === 'object') {
                parts.push(`${key}=${safeJson(value)}`);
            } else {
                parts.push(`${key}=${String(value)}`);
            }
        }
    }

    sink(parts.join(' | '));
};

function formatTimestamp(date: Date): string {
    return [
        date.getHours().toString().padStart(2, '0'),
        date.getMinutes().toString().padStart(2, '0'),
        date.getSeconds().toString().padStart(2, '0'),
    ].join(':') + `.${date.getMilliseconds().toString().padStart(3, '0')}`;
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
