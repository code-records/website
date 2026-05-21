import type { MessageJSONList, ValueList } from '../types';

export function collectToolCallInputs(messages: MessageJSONList, toolName: string, inputKey?: string): ValueList {
    const values: ValueList = [];
    const seen = new Set<string>();

    for (const msg of messages) {
        for (const plan of msg.plans || []) {
            for (const round of plan.rounds || []) {
                for (const action of round.actions || []) {
                    const toolCall = action.call;
                    if (action.type !== 'tool' || !toolCall) continue;
                    if (toolCall.name !== toolName) continue;

                    const value = inputKey ? toolCall.input?.[inputKey] : toolCall.input;
                    if (value == null) continue;

                    const key = typeof value === 'string' ? value : JSON.stringify(value);
                    if (seen.has(key)) continue;

                    seen.add(key);
                    values.push(value);
                }
            }
        }
    }

    return values;
}
