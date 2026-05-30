// import type { ContextJSON } from '../core/Context';
// import type { JsonValue } from './tool/Tool';

// export interface ToolTraceHistory {
//     context: ContextJSON;
// }

// export function collectToolCallInputs(history: ToolTraceHistory, toolName: string, inputKey?: string): JsonValue[] {
//     const values: JsonValue[] = [];
//     const seen = new Set<string>();

//     for (const message of history.context.messages) {
//         if (message.result === undefined) continue;
//         for (const round of message.result.rounds) {
//             for (const step of round.steps) {
//                 const call = step.call;
//                 if (step.type !== 'tool' || call === undefined || call.name !== toolName) {
//                     continue;
//                 }

//                 const value = inputKey === undefined ? call.input : call.input[inputKey];
//                 if (value === undefined) continue;

//                 const key = typeof value === 'string' ? value : safeStringify(value);
//                 if (seen.has(key)) continue;

//                 seen.add(key);
//                 values.push(value);
//             }
//         }
//     }

//     return values;
// }

// function safeStringify(value: JsonValue): string {
//     try {
//         return JSON.stringify(value);
//     } catch {
//         return String(value);
//     }
// }
