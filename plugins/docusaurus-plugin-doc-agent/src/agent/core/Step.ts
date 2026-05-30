import type { ModelToolCall } from '../model/Model';
import type { ToolEvent, ToolUsage } from '../tools/tool/Tool';
import type { AgentEvent, ClientStatus } from './type';

export type StepType =
    | 'context'
    | 'error'
    | 'thinking'
    | 'tool';

export interface StepJSON {
    call?: ModelToolCall;
    callId?: string;
    event?: ToolEvent;
    id?: string;
    kind?: 'step';
    label?: string;
    status: ClientStatus;
    text?: string;
    type: StepType;
    usage?: ToolUsage;
}

export class Step {
    readonly kind = 'step';
    type: StepType;
    status: ClientStatus = 'pending';
    label = '';
    text = '';
    usage?: ToolUsage;
    id: string;
    call?: ModelToolCall;
    callId?: string;
    event?: ToolEvent;

    constructor(json: StepJSON) {
        this.call = json.call;
        this.callId = json.callId;
        this.event = json.event;
        this.id = json.id ?? createStepId(json);
        this.label = json.label ?? '';
        this.status = json.status;
        this.text = json.text ?? '';
        this.type = json.type;
        this.usage = json.usage;
    }

    static fromJSON(json: StepJSON): Step {
        return new Step(json);
    }

    static fromAgentEvent(event: AgentEvent): Step | null {
        if (event.type !== 'model_event') {
            if (event.type === 'tool_start') {
                return new Step({
                    callId: event.callId,
                    label: event.label,
                    status: 'pending',
                    type: 'tool',
                    usage: event.usage,
                });
            }
            if (event.type === 'tool_done') {
                return new Step({
                    callId: event.callId,
                    label: event.label,
                    status: 'completed',
                    text: event.result.result,
                    type: 'tool',
                    usage: event.usage ?? event.result.usage,
                });
            }
            if (event.type === 'tool_event') {
                return new Step({
                    callId: event.callId,
                    event: event.event,
                    label: event.label,
                    status: 'completed',
                    type: 'tool',
                });
            }
            if (event.type === 'context_patch') {
                return new Step({
                    label: '上下文更新',
                    status: 'completed',
                    text: event.patch.type,
                    type: 'context',
                });
            }
            if (event.type === 'agent_error') {
                return new Step({
                    label: '错误',
                    status: 'failed',
                    text: event.error.message,
                    type: 'error',
                });
            }
            return null;
        }

        const modelEvent = event.event;
        if (modelEvent.type === 'action' && modelEvent.action.type === 'thinking') {
            return new Step({
                label: '思考',
                status: 'pending',
                text: modelEvent.action.content,
                type: 'thinking',
            });
        }
        if (modelEvent.type === 'action' && modelEvent.action.type === 'tool') {
            return new Step({
                call: modelEvent.action.call,
                callId: modelEvent.action.call.id,
                label: modelEvent.action.call.name,
                status: 'pending',
                type: 'tool',
            });
        }
        if (modelEvent.type === 'error') {
            return new Step({
                label: '模型错误',
                status: 'failed',
                text: modelEvent.error.message,
                type: 'error',
            });
        }
        return null;
    }

    append(text: string): void {
        this.text += text;
    }

    finish(): void {
        this.status = 'completed';
    }

    toJSON(): StepJSON {
        return {
            kind: this.kind,
            type: this.type,
            status: this.status,
            label: this.label.length > 0 ? this.label : undefined,
            text: this.text.length > 0 ? this.text : undefined,
            usage: this.usage,
            id: this.id,
            call: this.call,
            callId: this.callId,
            event: this.event,
        };
    }
}

let nextStepId = 1;

function createStepId(json: StepJSON): string {
    const callId = json.callId ?? json.call?.id;
    if (callId !== undefined && callId.length > 0) {
        return `tool:${callId}`;
    }
    return `${json.type}:${nextStepId++}`;
}
