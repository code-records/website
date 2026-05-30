type LoggerData = object | null;
type LoggerSink = (message: string, style: string, ...args: unknown[]) => void;

const baseStyle = 'padding:2px 4px;border-radius:2px;font-weight:bold;color:#fff;';

const LoggerStyle = {
    action: `${baseStyle}background:linear-gradient(90deg,#7c3aed,#ec4899);`,
    default: `${baseStyle}background:linear-gradient(90deg,#4a90e2,#6cc8ff);`,
    flow: `${baseStyle}background:linear-gradient(90deg,#f59e0b,#f97316);`,
    round: `${baseStyle}background:linear-gradient(90deg,#059669,#34d399);`,
} as const;

class Logger {
    private enabled = true;
    private sink: LoggerSink = (message, style, ...args) => globalThis.console?.log?.(message, style, ...args);

    set(enabled: boolean, sink?: LoggerSink): void {
        this.enabled = enabled;
        if (sink !== undefined) {
            this.sink = sink;
        }
    }

    log(event: string, data: LoggerData = null): void {
        this.write(event, data, LoggerStyle.default);
    }

    flow(data: LoggerData = null): void {
        this.write('agent.flow', data, LoggerStyle.flow);
    }

    round(data: LoggerData = null): void {
        this.write('agent.loop.round', data, LoggerStyle.round);
    }

    action(data: LoggerData = null): void {
        this.write('agent.loop.action', data, LoggerStyle.action);
    }

    private write(event: string, data: LoggerData, style: string): void {
        if (!this.enabled) return;

        const args: unknown[] = [];
        if (data !== null) {
            args.push(data);
        }

        this.sink(`%c [${formatTimestamp(new Date())}] ${event} `, style, ...args);
    }
}

export const logger = new Logger();

function formatTimestamp(date: Date): string {
    return [
        date.getHours().toString().padStart(2, '0'),
        date.getMinutes().toString().padStart(2, '0'),
        date.getSeconds().toString().padStart(2, '0'),
    ].join(':') + `.${date.getMilliseconds().toString().padStart(3, '0')}`;
}
