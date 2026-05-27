import { parseA2UIPayload, validateA2UIBasicCatalogMessages } from '../../../../ai/a2ui/A2UITransport.js';
import { Tool, type JsonObject, type ToolInput, type ToolInputSchema, type ToolResult, type ToolRunContext } from '../../../agent';

interface A2UIMessage {
    [key: string]: unknown;
}

const LIGHTWEIGHT_A2UI_TOOL_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        a2ui: {
            description: 'A2UI v0.9 server-to-client message, message array, or {messages:[...]} wrapper.',
        },
    },
    required: ['a2ui'],
};

class A2UITool extends Tool {
    name = 'a2ui';
    description = '提交 Google A2UI v0.9 server-to-client payload 给客户端渲染。输入必须是官方 A2UI message、message 数组或 {messages:[...]} wrapper。';
    input_schema: ToolInputSchema = LIGHTWEIGHT_A2UI_TOOL_SCHEMA;

    protected async execute(input: ToolInput, _context: ToolRunContext): Promise<ToolResult> {
        const messages = parseA2UIPayload(input.a2ui);
        if (!messages) {
            return {
                result: '[A2UI Error] Payload is not a valid A2UI v0.9 message, message array, or messages wrapper.',
            };
        }

        const catalogError = validateA2UIBasicCatalogMessages(messages);
        if (catalogError) {
            return {
                result: `[A2UI Error] ${catalogError}`,
            };
        }

        return {
            result: `[A2UI] accepted ${messages.length} message(s)`,
            events: [{ type: 'a2ui', data: { payload: messages.map(toJsonObject) } }],
        };
    }
}

export default new A2UITool();

function toJsonObject(message: A2UIMessage): JsonObject {
    const result: JsonObject = {};
    for (const [key, value] of Object.entries(message)) {
        if (isJsonValue(value)) {
            result[key] = value;
        }
    }
    return result;
}

function isJsonValue(value: unknown): value is JsonObject[string] {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return true;
    }
    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }
    if (typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).every(isJsonValue);
    }
    return false;
}
