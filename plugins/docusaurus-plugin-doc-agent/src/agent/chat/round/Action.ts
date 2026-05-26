import type { AgentEvent } from '../../Agent';
import type { ModelToolCall } from '../../model/Model';
import type { ToolEvent } from '../../tools/tool/Tool';

export type ActionType =
    | 'content'
    | 'context'
    | 'error'
    | 'thinking'
    | 'tool';

export interface ActionJSON {
    callId?: string;
    call?: ModelToolCall;
    content?: string;
    done: boolean;
    event?: ToolEvent;
    label?: string;
    type: ActionType;
}

export class Action {
    callId?: string;
    call?: ModelToolCall;
    content = '';
    done = false;
    event?: ToolEvent;
    label = '';
    type: ActionType;

    constructor(json: ActionJSON) {
        this.type = json.type;
        this.callId = json.callId;
        this.content = json.content ?? '';
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
                    label: event.tool,
                    type: 'tool',
                });
            }
            if (event.type === 'tool_done') {
                return new Action({
                    callId: event.callId,
                    content: event.result.result,
                    done: true,
                    label: event.tool,
                    type: 'tool',
                });
            }
            if (event.type === 'tool_event') {
                return new Action({
                    done: true,
                    event: event.event,
                    label: event.tool,
                    type: 'tool',
                });
            }
            if (event.type === 'context_patch') {
                return new Action({
                    content: event.patch.type,
                    done: true,
                    label: 'context',
                    type: 'context',
                });
            }
            if (event.type === 'agent_error') {
                return new Action({
                    content: event.error.message,
                    done: true,
                    label: 'error',
                    type: 'error',
                });
            }
            return null;
        }

        const modelEvent = event.event;
        if (modelEvent.type === 'content_delta') {
            return new Action({
                content: modelEvent.content,
                done: false,
                type: 'content',
            });
        }
        if (modelEvent.type === 'action' && modelEvent.action.type === 'thinking') {
            return new Action({
                content: modelEvent.action.content,
                done: false,
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
                content: modelEvent.error.message,
                done: true,
                label: 'model',
                type: 'error',
            });
        }
        return null;
    }

    append(content: string): void {
        this.content += content;
    }

    finish(): void {
        this.done = true;
    }

    toJSON(): ActionJSON {
        return {
            callId: this.callId,
            call: this.call,
            content: this.content.length > 0 ? this.content : undefined,
            done: this.done,
            event: this.event,
            label: this.label.length > 0 ? this.label : undefined,
            type: this.type,
        };
    }
}
