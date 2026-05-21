import type { LogData } from '../types';

let isDebug = false;

export function setLogger(debug: boolean): void {
    isDebug = debug;
}

export function logger(event: string, data: LogData | null = null): void {
    if (!isDebug) return;
    if (!globalThis.console?.log) return;

    const t = new Date();
    const ts = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}:${t.getSeconds().toString().padStart(2, '0')}.${t.getMilliseconds().toString().padStart(3, '0')}`;
    const parts = [`[${ts}] ${event}`];

    if (data !== null) {
        for (const [key, value] of Object.entries(data)) {
            if (value === undefined || value === null) continue;
            if (Array.isArray(value)) {
                parts.push(`${key}=[${value.length}]`);
            } else if (typeof value === 'object') {
                parts.push(`${key}=${JSON.stringify(value)}`);
            } else {
                parts.push(`${key}=${value}`);
            }
        }
    }

    console.log(parts.join(' | '));
}
