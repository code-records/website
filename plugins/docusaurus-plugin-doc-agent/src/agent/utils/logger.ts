export interface Logger {
    (event: string, data?: object | null): void;
}

let enabled = true; // 默认开启日志，让链路日志在调试中默认可见！
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
    const args: any[] = [];
    if (data !== null) {
        args.push(data);
    }

    // 完美采用用户特别定制的带有酷炫线性渐变高亮的控制台日志输出
    console.log(
        `%c [${timestamp}] ${event} `,
        "padding:2px 4px;border-radius:2px;font-weight:bold;color:#fff;" +
        "background:linear-gradient(90deg,#4a90e2,#6cc8ff);",
        ...args
    );
};

function formatTimestamp(date: Date): string {
    return [
        date.getHours().toString().padStart(2, '0'),
        date.getMinutes().toString().padStart(2, '0'),
        date.getSeconds().toString().padStart(2, '0'),
    ].join(':') + `.${date.getMilliseconds().toString().padStart(3, '0')}`;
}
