import type { JsonObject, JsonValue } from '../tools/tool/Tool';

/** 工具调用是 agent 运行态数据，由 model、loop、Round/Action 共同使用。 */
export interface ToolCall {
    id: string;
    name: string;
    input: JsonObject;
    result?: JsonValue;
}
