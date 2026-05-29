import type { Message } from '../chat/Message';
import { estimateContextTokens } from '../utils/tokenEstimator';
import {
    Tool,
    type JsonObject,
    type ToolActivity,
    type ToolAskPrompt,
    type ToolInput,
    type ToolPromptSchema,
    type ToolResult,
    type ToolRunContext,
} from './tool/Tool';

export interface CompressToolOptions {
    keepTail?: number;
    threshold?: number;
}

interface CompressAskInput extends JsonObject {
    contextPreview: string;
    keepTail: number;
    tokenEstimate: number;
}

interface CompressAskOutput extends JsonObject {
    summary: string;
}

export class CompressTool extends Tool {
    name = 'compress_context';
    description = 'Compact the current agent context when it grows too large. Use this before continuing if context is near the model limit.';
    prompt: ToolPromptSchema = {
        properties: {
            reason: {
                description: 'Why context compaction is needed',
                type: 'string',
            },
        },
        type: 'object',
    };

    private readonly keepTail: number;
    private readonly threshold: number;

    private readonly summaryPrompt: ToolAskPrompt<CompressAskInput, CompressAskOutput> = {
        name: 'compress_context.summary',
        build: input => [
            'Summarize the previous agent context so the model can continue safely.',
            '',
            'Preserve:',
            '- user goals and constraints',
            '- decisions already made',
            '- tool results and file paths',
            '- unresolved tasks',
            '',
            `Estimated tokens: ${input.tokenEstimate}`,
            `Tail messages kept verbatim: ${input.keepTail}`,
            '',
            'Context preview:',
            input.contextPreview,
            '',
            'Return only a concise summary.',
        ].join('\n'),
        parse: content => ({ summary: content.trim() }),
    };

    constructor({ keepTail = 6, threshold = 12000 }: CompressToolOptions = {}) {
        super();
        this.keepTail = keepTail;
        this.threshold = threshold;
    }

    formatActivity(_input: ToolInput): ToolActivity {
        return {
            count: 1,
            name: '上下文',
            unit: '次',
            verb: '压缩',
        };
    }

    protected async execute(_input: ToolInput, context: ToolRunContext): Promise<ToolResult> {
        const tokenEstimate = estimateContextTokens(context.context);
        if (tokenEstimate <= this.threshold) {
            return {
                result: `Context compaction skipped. Estimated tokens ${tokenEstimate} is below threshold ${this.threshold}.`,
            };
        }

        const tail = context.context.slice(-this.keepTail);
        const compacted = context.context.slice(0, Math.max(0, context.context.length - this.keepTail));
        const answer = await this.askModel({
            input: {
                contextPreview: previewContext(compacted),
                keepTail: this.keepTail,
                tokenEstimate,
            },
            prompt: this.summaryPrompt,
        });

        if (answer.summary.length === 0) {
            return {
                result: 'Context compaction failed: model returned an empty summary.',
            };
        }

        const summaryMessage = context.createUserContextMessage(`[Previous context summary]\n${answer.summary}`);
        return {
            contextPatch: {
                context: [
                    summaryMessage,
                    ...tail,
                ],
                summary: answer.summary,
                type: 'compact',
            },
            events: [{
                data: {
                    afterCount: tail.length + 1,
                    beforeCount: context.context.length,
                    tokenEstimate,
                },
                type: 'context_compacted',
            }],
            result: `Context compacted. Kept ${tail.length} tail messages and summarized ${compacted.length} earlier messages.`,
        };
    }
}

function previewContext(context: readonly Message[]): string {
    return context
        .map((message, index) => `${index + 1}. [${message.role}] ${safeStringify(message)}`)
        .join('\n')
        .slice(0, 12000);
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
