import { defineTool } from './toolRegistry';
import type { AgentToolList, ToolEvent, ToolInput, UnknownRecord } from '../types';

/**
 * Built-in planning tools.
 *
 * These tools let the model emit a structured plan before executing complex tasks.
 * They only record plan state and emit tool events; execution is still driven by the model.
 */

interface PlanStep {
    description: string;
    index: number;
    status: string;
    title: string;
}

interface MakePlanInput extends ToolInput {
    goal?: string;
    steps?: unknown[];
}

interface MakePlanEvent extends ToolEvent {
    plan: {
        goal: string;
        steps: PlanStep[];
    };
    type: 'plan_created';
}

interface UpdatePlanInput extends ToolInput {
    note?: string;
    status?: 'done' | 'skipped' | 'in_progress';
    step?: number;
}

interface UpdatePlanEvent extends ToolEvent {
    note?: string;
    status: 'done' | 'skipped' | 'in_progress';
    step: number;
    type: 'plan_updated';
}

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const planTool = defineTool<'make_plan', MakePlanInput, string, MakePlanEvent>({
    name: 'make_plan',
    description: 'Create a step-by-step plan before executing a complex task. Use this when the task requires multiple steps or tool calls. Output your plan as a list of steps.',
    input_schema: {
        type: 'object',
        properties: {
            steps: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        title: { type: 'string', description: 'Short step title' },
                        description: { type: 'string', description: 'What to do in this step' },
                    },
                    required: ['title'],
                },
                description: 'List of planned steps',
            },
            goal: {
                type: 'string',
                description: 'The overall goal of this plan',
            },
        },
        required: ['steps'],
    },
    async execute(input) {
        const inputSteps = Array.isArray(input.steps) ? input.steps : [];
        const steps = inputSteps.map((value, i) => {
            const s = isRecord(value) ? value : {};
            return {
                index: i + 1,
                title: typeof s.title === 'string' ? s.title : '',
                description: typeof s.description === 'string' ? s.description : '',
                status: 'pending',
            };
        });
        const plan = {
            goal: typeof input.goal === 'string' ? input.goal : '',
            steps,
        };

        const summary = plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n');
        return {
            result: `Plan created (${plan.steps.length} steps):\n${summary}\n\nProceed with step 1.`,
            event: { type: 'plan_created', plan },
        };
    },
});

export const updatePlanTool = defineTool<'update_plan', UpdatePlanInput, string, UpdatePlanEvent>({
    name: 'update_plan',
    description: 'Update the status of a plan step (mark as done, skip, or modify).',
    input_schema: {
        type: 'object',
        properties: {
            step: {
                type: 'integer',
                description: 'Step number (1-based)',
            },
            status: {
                type: 'string',
                enum: ['done', 'skipped', 'in_progress'],
                description: 'New status for this step',
            },
            note: {
                type: 'string',
                description: 'Optional note about the result',
            },
        },
        required: ['step', 'status'],
    },
    async execute(input) {
        const note = typeof input.note === 'string' ? input.note : '';
        const status = input.status || 'in_progress';
        const step = typeof input.step === 'number' ? input.step : 0;
        return {
            result: `Step ${step} marked as ${status}.${note ? ' Note: ' + note : ''}`,
            event: { type: 'plan_updated', step, status, note },
        };
    },
});

export const PLAN_TOOLS: AgentToolList = [planTool, updatePlanTool];
