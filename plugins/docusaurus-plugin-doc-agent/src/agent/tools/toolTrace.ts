import type { HistoryJSON } from '../chat/History';
import type { JsonValue } from './tool/Tool';

export function collectToolCallInputs(history: HistoryJSON, toolName: string, inputKey?: string): JsonValue[] {
    const values: JsonValue[] = [];
    const seen = new Set<string>();

    for (const message of history.messages) {
        const plan = message.plan;
        if (plan === undefined) continue;

        for (const round of plan.rounds) {
            for (const action of round.actions) {
                const call = action.call;
                if (action.type !== 'tool' || call === undefined || call.name !== toolName) {
                    continue;
                }

                const value = inputKey === undefined ? call.input : call.input[inputKey];
                if (value === undefined) continue;

                const key = typeof value === 'string' ? value : safeStringify(value);
                if (seen.has(key)) continue;

                seen.add(key);
                values.push(value);
            }
        }
    }

    return values;
}

function safeStringify(value: JsonValue): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
