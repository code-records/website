import type {
    ToolMap,
    ToolResult,
} from '../types';
import type { Action } from '../round/Action';

export async function executeToolAction(tools: ToolMap, action: Action): Promise<ToolResult> {
    const call = action.call;
    if (call === undefined) throw new Error('Tool action is missing call');

    const tool = tools[call.name];
    if (tool === undefined) throw new Error(`Unknown tool: ${call.name}`);

    try {
        const timeout = tool.timeout ?? 30000;
        if (timeout <= 0) return await tool.execute(call.input);

        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
            return await Promise.race([
                tool.execute(call.input),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`Tool "${call.name}" timed out`)), timeout);
                }),
            ]);
        } finally {
            if (timer !== null) clearTimeout(timer);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { result: `[Tool Error] ${message}` };
    }
}
