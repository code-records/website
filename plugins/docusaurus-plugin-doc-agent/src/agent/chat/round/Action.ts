import type { AgentEvent } from '../../Agent';
import type { ModelToolCall } from '../../model/Model';
import type { ToolEvent, ToolUsage } from '../../tools/tool/Tool';
import type { ClientStatus } from './Plan';

export type ActionType =
    | 'context'
    | 'error'
    | 'thinking'
    | 'tool';

export interface ActionJSON {
    call?: ModelToolCall;
    callId?: string;
    event?: ToolEvent;
    id?: string;
    kind?: 'action';
    label?: string;
    status: ClientStatus;
    text?: string;
    type: ActionType;
    usage?: ToolUsage;
}

export class Action {
    readonly kind = 'action';
    type: ActionType;
    status: ClientStatus = 'pending';
    label = '';
    text = '';
    id: string;
    call?: ModelToolCall;
    callId?: string;
    event?: ToolEvent;
    usage?: ToolUsage;

    constructor(json: ActionJSON) {
        this.call = json.call;
        this.callId = json.callId;
        this.event = json.event;
        this.id = json.id ?? createActionId(json);
        this.label = json.label ?? '';
        this.status = json.status;
        this.text = json.text ?? '';
        this.type = json.type;
        this.usage = json.usage;
    }

    static fromJSON(json: ActionJSON): Action {
        return new Action(json);
    }

    static fromAgentEvent(event: AgentEvent): Action | null {
        if (event.type !== 'model_event') {
            if (event.type === 'tool_start') {
                return new Action({
                    callId: event.callId,
                    label: event.label,
                    status: 'pending',
                    type: 'tool',
                    usage: event.usage,
                });
            }
            if (event.type === 'tool_done') {
                return new Action({
                    callId: event.callId,
                    label: event.label,
                    status: 'completed',
                    text: event.result.result,
                    type: 'tool',
                    usage: event.usage ?? event.result.usage,
                });
            }
            if (event.type === 'tool_event') {
                return new Action({
                    callId: event.callId,
                    event: event.event,
                    label: event.label,
                    status: 'completed',
                    type: 'tool',
                });
            }
            if (event.type === 'context_patch') {
                return new Action({
                    label: '\u4e0a\u4e0b\u6587\u66f4\u65b0',
                    status: 'completed',
                    text: event.patch.type,
                    type: 'context',
                });
            }
            if (event.type === 'agent_error') {
                return new Action({
                    label: '\u9519\u8bef',
                    status: 'failed',
                    text: event.error.message,
                    type: 'error',
                });
            }
            return null;
        }

        const modelEvent = event.event;
        if (modelEvent.type === 'action' && modelEvent.action.type === 'thinking') {
            return new Action({
                label: '\u601d\u8003',
                status: 'pending',
                text: modelEvent.action.content,
                type: 'thinking',
            });
        }
        if (modelEvent.type === 'action' && modelEvent.action.type === 'tool') {
            return new Action({
                call: modelEvent.action.call,
                callId: modelEvent.action.call.id,
                label: modelEvent.action.call.name,
                status: 'pending',
                type: 'tool',
            });
        }
        if (modelEvent.type === 'error') {
            return new Action({
                label: '\u6a21\u578b\u9519\u8bef',
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

    toJSON(): ActionJSON {
        return {
            kind: this.kind,
            type: this.type,
            status: this.status,
            label: this.label.length > 0 ? this.label : undefined,
            text: this.text.length > 0 ? this.text : undefined,
            id: this.id,
            call: this.call,
            callId: this.callId,
            event: this.event,
            usage: this.usage,
        };
    }
}

let nextActionId = 1;

function createActionId(json: ActionJSON): string {
    const callId = json.callId ?? json.call?.id;
    if (callId !== undefined && callId.length > 0) {
        return `tool:${callId}`;
    }
    return `${json.type}:${nextActionId++}`;
}
