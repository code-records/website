import { Tool, type JsonObject, type ToolInput, type ToolInputSchema, type ToolResult, type ToolRunContext } from './Tool';

export interface ModeToolDefinition extends JsonObject {
    description: string;
    name: string;
}

export interface ModeToolOptions {
    modes: readonly ModeToolDefinition[];
}

export class ModeTool extends Tool {
    name = 'switch_mode';
    description: string;
    input_schema: ToolInputSchema;

    private readonly modes: ReadonlyMap<string, ModeToolDefinition>;

    constructor({ modes }: ModeToolOptions) {
        super();
        this.modes = new Map(modes.map(mode => [mode.name, mode]));
        const modeNames = Array.from(this.modes.keys());

        this.description = [
            'Request a working mode switch when the current tools or instructions are insufficient.',
            `Available modes: ${modeNames.join(', ')}.`,
        ].join(' ');

        this.input_schema = {
            properties: {
                mode: {
                    description: 'Target mode',
                    enum: modeNames,
                    type: 'string',
                },
                reason: {
                    description: 'Why this mode is needed',
                    type: 'string',
                },
            },
            required: ['mode'],
            type: 'object',
        };
    }

    protected async execute(input: ToolInput, _context: ToolRunContext): Promise<ToolResult> {
        const mode = typeof input.mode === 'string' ? input.mode : '';
        const reason = typeof input.reason === 'string' ? input.reason : '';
        const target = this.modes.get(mode);

        if (target === undefined) {
            return {
                result: `Mode switch failed: unknown mode "${mode}". Available modes: ${Array.from(this.modes.keys()).join(', ')}`,
            };
        }

        return {
            events: [{
                data: {
                    description: target.description,
                    mode,
                    reason,
                },
                type: 'mode_switch',
            }],
            result: `Requested mode switch to "${mode}".`,
        };
    }
}

export function createModeTool(options: ModeToolOptions): ModeTool {
    return new ModeTool(options);
}
