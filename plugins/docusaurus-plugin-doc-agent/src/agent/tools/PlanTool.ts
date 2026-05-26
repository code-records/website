import { Tool, type JsonObject, type ToolInput, type ToolInputSchema, type ToolResult, type ToolRunContext } from './tool/Tool';

export interface PlanStep extends JsonObject {
    description: string;
    index: number;
    status: string;
    title: string;
}

export class MakePlanTool extends Tool {
    name = 'make_plan';
    description = 'Create a step-by-step plan before executing a complex task.';
    input_schema: ToolInputSchema = {
        properties: {
            goal: {
                description: 'The overall goal of this plan',
                type: 'string',
            },
            steps: {
                description: 'List of planned steps',
                items: {
                    properties: {
                        description: { description: 'What to do in this step', type: 'string' },
                        title: { description: 'Short step title', type: 'string' },
                    },
                    required: ['title'],
                    type: 'object',
                },
                type: 'array',
            },
        },
        required: ['steps'],
        type: 'object',
    };

    protected async execute(input: ToolInput, _context: ToolRunContext): Promise<ToolResult> {
        const rawSteps = Array.isArray(input.steps) ? input.steps : [];
        const steps: PlanStep[] = rawSteps.map((value, index) => {
            const item = isJsonObject(value) ? value : {};
            return {
                description: typeof item.description === 'string' ? item.description : '',
                index: index + 1,
                status: 'pending',
                title: typeof item.title === 'string' ? item.title : '',
            };
        });
        const goal = typeof input.goal === 'string' ? input.goal : '';

        return {
            events: [{
                data: {
                    goal,
                    steps,
                },
                type: 'plan_created',
            }],
            result: `Plan created (${steps.length} steps):\n${steps.map(step => `${step.index}. ${step.title}`).join('\n')}`,
        };
    }
}

export class UpdatePlanTool extends Tool {
    name = 'update_plan';
    description = 'Update the status of a plan step.';
    input_schema: ToolInputSchema = {
        properties: {
            note: {
                description: 'Optional note about the result',
                type: 'string',
            },
            status: {
                description: 'New status for this step',
                enum: ['done', 'skipped', 'in_progress'],
                type: 'string',
            },
            step: {
                description: 'Step number, 1-based',
                type: 'integer',
            },
        },
        required: ['step', 'status'],
        type: 'object',
    };

    protected async execute(input: ToolInput, _context: ToolRunContext): Promise<ToolResult> {
        const note = typeof input.note === 'string' ? input.note : '';
        const status = typeof input.status === 'string' ? input.status : 'in_progress';
        const step = typeof input.step === 'number' ? input.step : 0;

        return {
            events: [{
                data: {
                    note,
                    status,
                    step,
                },
                type: 'plan_updated',
            }],
            result: `Step ${step} marked as ${status}.${note.length > 0 ? ` Note: ${note}` : ''}`,
        };
    }
}

export function createPlanTools(): Tool[] {
    return [new MakePlanTool(), new UpdatePlanTool()];
}

function isJsonObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
