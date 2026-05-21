import { defineTool } from './toolRegistry';
import type { RuntimeTool, ToolEvent, ToolInput, UnknownRecord } from '../types';

interface ModeToolInput extends ToolInput {
    mode?: string;
    reason?: string;
}

interface ModeToolEvent extends ToolEvent {
    mode: string;
    reason?: string;
    type: 'mode_switch';
}

export function createModeTool(modes: UnknownRecord): RuntimeTool {
    const modeNames = Object.keys(modes);

    return defineTool({
        name: 'switch_mode',
        description: `Switch to a different working mode. Available modes: ${modeNames.join(', ')}. Each mode has specialized tools and focus. Use this when the current mode's tools are insufficient for the next step.`,
        input_schema: {
            type: 'object',
            properties: {
                mode: {
                    type: 'string',
                    enum: modeNames,
                    description: 'Target mode to switch to',
                },
                reason: {
                    type: 'string',
                    description: 'Why switching to this mode',
                },
            },
            required: ['mode'],
        },
        async execute(input) {
            const mode = typeof input.mode === 'string' ? input.mode : '';
            const target = modes[mode];
            if (!target) {
                return { result: `[Error] Unknown mode: ${mode}` };
            }
            return {
                result: `Switched to "${mode}" mode.`,
                event: { type: 'mode_switch', mode, reason: input.reason },
            };
        },
    });
}
