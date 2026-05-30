import type { ModelEvent, ModelResponse } from '../model/Model';
import type { ContextPatch, ToolEvent, ToolResult, ToolUsage } from '../tools/tool/Tool';

export type ClientStatus = 'pending' | 'completed' | 'failed';

export type AgentEvent =
    | { type: 'agent_start'; agent: string }
    | { type: 'model_event'; agent: string; event: ModelEvent }
    | { type: 'tool_start'; agent: string; tool: string; callId: string; label: string; usage?: ToolUsage }
    | { type: 'tool_done'; agent: string; tool: string; callId: string; label: string; result: ToolResult; usage?: ToolUsage }
    | { type: 'tool_event'; agent: string; tool: string; callId: string; label: string; event: ToolEvent }
    | { type: 'context_patch'; agent: string; tool: string; patch: ContextPatch }
    | { type: 'agent_done'; agent: string; response?: ModelResponse }
    | { type: 'agent_error'; agent: string; error: Error };
