import type {
    AgentTool,
    AgentToolList,
    AgentToolLists,
    ToolEvent,
    ToolInput,
    ToolMap,
    ToolResultValue,
} from '../types';

export function defineTool<
    TName extends string,
    TInput extends ToolInput,
    TResult extends ToolResultValue,
    TEvent extends ToolEvent,
>(tool: AgentTool<TName, TInput, TResult, TEvent>): AgentTool<TName, TInput, TResult, TEvent> {
    return tool;
}

export function createToolMap(tools: AgentToolList = []): ToolMap {
    if (!Array.isArray(tools)) {
        throw new Error('createToolMap expects an array of tools');
    }

    const map: ToolMap = {};
    for (const tool of tools) {
        if (!tool?.name) throw new Error('Tool is missing name');
        if (typeof tool.execute !== 'function') {
            throw new Error(`Tool "${tool.name}" is missing execute(input)`);
        }
        map[tool.name] = tool;
    }
    return map;
}

/**
 * Merge multiple tool arrays into a single registry.
 * Useful for combining business tools with built-in tools (plan, spawn_agent).
 */
export function mergeTools(...toolArrays: AgentToolLists): AgentToolList {
    const tools: AgentToolList = [];
    for (const toolArray of toolArrays) {
        for (const tool of toolArray) {
            if (tool) tools.push(tool);
        }
    }
    return tools;
}
