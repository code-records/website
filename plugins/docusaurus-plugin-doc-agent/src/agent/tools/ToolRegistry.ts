import type { Tool, ToolDefinition } from './Tool';

export class ToolRegistry {
    private readonly tools: Map<string, Tool>;

    constructor(tools: readonly Tool[] = []) {
        this.tools = new Map();
        for (const tool of tools) {
            this.register(tool);
        }
    }

    register(tool: Tool): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Duplicate tool registered: ${tool.name}`);
        }
        this.tools.set(tool.name, tool);
    }

    get(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    require(name: string): Tool {
        const tool = this.get(name);
        if (tool === undefined) {
            throw new Error(`Tool not found: ${name}`);
        }
        return tool;
    }

    definitions(): ToolDefinition[] {
        return this.list().map(tool => tool.toDefinition());
    }

    list(): Tool[] {
        return Array.from(this.tools.values());
    }

    asReadonlyMap(): ReadonlyMap<string, Tool> {
        return this.tools;
    }
}
