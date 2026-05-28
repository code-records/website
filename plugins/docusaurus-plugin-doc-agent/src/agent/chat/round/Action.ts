import type { AgentEvent } from '../../Agent';
import type { ModelToolCall } from '../../model/Model';
import type { ToolEvent } from '../../tools/tool/Tool';

export type ActionType =
    | 'context'
    | 'error'
    | 'thinking'
    | 'tool';

export interface ActionJSON {
    callId?: string;
    call?: ModelToolCall;
    done: boolean;
    event?: ToolEvent;
    label?: string;
    text?: string;
    type: ActionType;
}

export class Action {
    callId?: string;
    call?: ModelToolCall;
    done = false;
    event?: ToolEvent;
    label = '';
    text = '';
    type: ActionType;

    constructor(json: ActionJSON) {
        this.type = json.type;
        this.callId = json.callId;
        this.text = json.text ?? '';
        this.call = json.call;
        this.done = json.done;
        this.event = json.event;
        this.label = json.label ?? '';
    }

    static fromJSON(json: ActionJSON): Action {
        return new Action(json);
    }

    static fromAgentEvent(event: AgentEvent): Action | null {
        if (event.type !== 'model_event') {
            if (event.type === 'tool_start') {
                return new Action({
                    callId: event.callId,
                    done: false,
                    label: event.label,
                    type: 'tool',
                });
            }
            if (event.type === 'tool_done') {
                return new Action({
                    callId: event.callId,
                    done: true,
                    label: event.label,
                    text: event.result.result,
                    type: 'tool',
                });
            }
            if (event.type === 'tool_event') {
                return new Action({
                    callId: event.callId,
                    done: true,
                    event: event.event,
                    label: event.label,
                    type: 'tool',
                });
            }
            if (event.type === 'context_patch') {
                return new Action({
                    done: true,
                    label: '上下文更新',
                    text: event.patch.type,
                    type: 'context',
                });
            }
            if (event.type === 'agent_error') {
                return new Action({
                    done: true,
                    label: '错误',
                    text: event.error.message,
                    type: 'error',
                });
            }
            return null;
        }

        const modelEvent = event.event;
        if (modelEvent.type === 'action' && modelEvent.action.type === 'thinking') {
            return new Action({
                done: false,
                label: '思考',
                text: modelEvent.action.content,
                type: 'thinking',
            });
        }
        if (modelEvent.type === 'action' && modelEvent.action.type === 'tool') {
            return new Action({
                call: modelEvent.action.call,
                callId: modelEvent.action.call.id,
                done: false,
                label: modelEvent.action.call.name,
                type: 'tool',
            });
        }
        if (modelEvent.type === 'error') {
            return new Action({
                done: true,
                label: '模型错误',
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
        this.done = true;
    }

    toJSON(): ActionJSON {
        return {
            callId: this.callId,
            call: this.call,
            done: this.done,
            event: this.event,
            label: this.label.length > 0 ? this.label : undefined,
            text: this.text.length > 0 ? this.text : undefined,
            type: this.type,
        };
    }
}
