import { Tool, type JsonObject, type ToolActivity, type ToolInput, type ToolPromptSchema, type ToolResult, type ToolRunContext } from './tool/Tool';

export interface PlanStep extends JsonObject {
    description: string;
    index: number;
    status: string;
    title: string;
}

export class MakePlanTool extends Tool {
    name = 'make_plan';
    description = 'Create a step-by-step plan before executing a complex task.';
    prompt: ToolPromptSchema = {
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

    formatActivity(input: ToolInput): ToolActivity {
        const rawSteps = Array.isArray(input.steps) ? input.steps : [];
        return {
            count: rawSteps.length,
            name: '步骤',
            unit: '个',
            verb: '规划',
        };
    }

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
    prompt: ToolPromptSchema = {
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

    formatActivity(input: ToolInput): ToolActivity {
        const step = typeof input.step === 'number' ? String(input.step) : '';
        return {
            key: step,
            name: '步骤',
            unit: '个',
            verb: '更新',
        };
    }

    protected async execute(input: ToolInput, _context: ToolRunContext): Promise<ToolResult> {
        if (typeof input.step !== 'number') {
            return { result: 'update_plan failed: step (number) is required.' };
        }
        if (!isValidPlanStatus(input.status)) {
            return { result: `update_plan failed: status must be one of done, skipped, in_progress. Got "${String(input.status)}".` };
        }
        const note = typeof input.note === 'string' ? input.note : '';
        const step = input.step;
        const status = input.status;

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


function isJsonObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidPlanStatus(value: unknown): value is 'done' | 'skipped' | 'in_progress' {
    return value === 'done' || value === 'skipped' || value === 'in_progress';
}
