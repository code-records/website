import type {
    ActionJSON,
    ToolCall,
    ToolEvent,
} from '../types';

export interface ActionOptions {
    call?: ToolCall;
    content?: string;
    done?: boolean;
    event?: ToolEvent;
    label?: string;
    type: ActionJSON['type'];
}

export class Action {
    type: ActionJSON['type'];
    content: string;
    call?: ToolCall;
    label: string;
    done: boolean;
    event?: ToolEvent;

    constructor({ type, content, call, label, done, event }: ActionOptions) {
        this.type = type;
        this.content = content ?? '';
        this.call = call !== undefined ? { ...call, input: { ...call.input } } : undefined;
        this.label = label ?? content ?? '';
        this.done = done === true;
        this.event = event;
    }

    static fromJSON(json: ActionJSON): Action {
        return new Action(json);
    }

    toJSON(): ActionJSON {
        return {
            type: this.type,
            content: this.content.length > 0 ? this.content : undefined,
            call: this.call,
            label: this.label,
            done: this.done,
            event: this.event,
        };
    }
}
