// import type { Agent } from '../core/Agent';
// import { ContextMessage } from '../core/Context';
// import type { AgentEvent } from '../core/type';
// import { Tool, type JsonObject, type ToolUsage, type ToolInput, type ToolPromptSchema, type ToolResult, type ToolRunContext } from './tool/Tool';

// export interface SubAgentToolOptions {
//     maxResultChars?: number;
//     subAgents: readonly Agent[];
// }

// interface SubAgentRunInput {
//     agent: string;
//     context: string;
//     task: string;
// }

// export class SubAgentTool extends Tool {
//     name = 'run_sub_agent';
//     description: string;
//     prompt: ToolPromptSchema;

//     private readonly maxResultChars: number;
//     private readonly subAgents: ReadonlyMap<string, Agent>;

//     constructor({ maxResultChars = 12000, subAgents }: SubAgentToolOptions) {
//         super();
//         this.maxResultChars = maxResultChars;
//         this.subAgents = new Map(subAgents.map(agent => [agent.name, agent]));
//         const names = Array.from(this.subAgents.keys());

//         this.description = [
//             'Delegate an independent subtask to a registered sub-agent.',
//             names.length > 0 ? `Available sub-agents: ${names.join(', ')}.` : 'No sub-agents are currently registered.',
//         ].join(' ');

//         this.prompt = {
//             properties: {
//                 agent: {
//                     description: 'Sub-agent name',
//                     enum: names,
//                     type: 'string',
//                 },
//                 context: {
//                     description: 'Optional background for the sub-agent',
//                     type: 'string',
//                 },
//                 task: {
//                     description: 'Task for the sub-agent to complete',
//                     type: 'string',
//                 },
//             },
//             required: ['agent', 'task'],
//             type: 'object',
//         };
//     }

//     formatUsage(input: ToolInput): ToolUsage {
//         const agent = typeof input.agent === 'string' ? input.agent : '';
//         return {
//             key: agent,
//             name: '子 Agent',
//             unit: '个',
//             verb: '调用',
//         };
//     }

//     protected async execute(input: ToolInput, context: ToolRunContext): Promise<ToolResult> {
//         const parsed = parseInput(input);
//         const subAgent = this.subAgents.get(parsed.agent);
//         if (subAgent === undefined) {
//             return {
//                 result: `Sub-agent not found: ${parsed.agent || '(empty)'}. Available sub-agents: ${Array.from(this.subAgents.keys()).join(', ')}`,
//             };
//         }

//         const prompt = parsed.context.length > 0
//             ? `Context:\n${parsed.context}\n\nTask:\n${parsed.task}`
//             : parsed.task;

//         const events: JsonObject[] = [];
//         let content = '';

//         const subContext = context.context.clone();
//         subContext.append(ContextMessage.user(prompt));

//         for await (const event of subAgent.run({ context: subContext, signal: context.signal })) {
//             events.push(agentEventToJson(event));
//             if (event.type === 'agent_error') {
//                 return {
//                     events: [{
//                         data: {
//                             agent: parsed.agent,
//                             error: event.error.message,
//                             task: parsed.task,
//                         },
//                         type: 'sub_agent_error',
//                     }],
//                     result: `[Sub-agent error] ${event.error.message}`,
//                 };
//             }
//             if (event.type === 'agent_done') {
//                 content = event.response?.content ?? content;
//             }
//             if (event.type === 'model_event' && event.event.type === 'content') {
//                 content += event.event.content;
//             }
//         }

//         const result = truncate(content.trim(), this.maxResultChars) || '[Sub-agent returned no content]';

//         return {
//             events: [{
//                 data: {
//                     agent: parsed.agent,
//                     eventCount: events.length,
//                     events,
//                     task: parsed.task,
//                 },
//                 type: 'sub_agent_done',
//             }],
//             result,
//         };
//     }
// }

// export function createSubAgentTool(options: SubAgentToolOptions): SubAgentTool {
//     return new SubAgentTool(options);
// }

// function parseInput(input: ToolInput): SubAgentRunInput {
//     return {
//         agent: typeof input.agent === 'string' ? input.agent : '',
//         context: typeof input.context === 'string' ? input.context : '',
//         task: typeof input.task === 'string' ? input.task : '',
//     };
// }

// function truncate(value: string, maxChars: number): string {
//     if (maxChars <= 0 || value.length <= maxChars) {
//         return value;
//     }
//     return `${value.slice(0, maxChars)}\n\n[Sub-agent response truncated]`;
// }

// function agentEventToJson(event: AgentEvent): JsonObject {
//     switch (event.type) {
//         case 'agent_start':
//             return { agent: event.agent, type: event.type };
//         case 'agent_done':
//             return { agent: event.agent, type: event.type };
//         case 'agent_error':
//             return { agent: event.agent, error: event.error.message, type: event.type };
//         case 'model_event':
//             return { agent: event.agent, modelEvent: event.event.type, type: event.type };
//         case 'tool_start':
//             return { agent: event.agent, callId: event.callId, label: event.label, tool: event.tool, type: event.type };
//         case 'tool_done':
//             return { agent: event.agent, callId: event.callId, label: event.label, tool: event.tool, type: event.type };
//         case 'tool_event':
//             return { agent: event.agent, callId: event.callId, eventType: event.event.type, label: event.label, tool: event.tool, type: event.type };
//         case 'context_patch':
//             return { agent: event.agent, patchType: event.patch.type, tool: event.tool, type: event.type };
//         case 'sub_agent_start':
//             return { agent: event.agent, subAgent: event.subAgent, type: event.type };
//         case 'sub_agent_event':
//             return { agent: event.agent, subAgent: event.subAgent, type: event.type };
//         case 'sub_agent_done':
//             return { agent: event.agent, subAgent: event.subAgent, type: event.type };
//     }
// }
