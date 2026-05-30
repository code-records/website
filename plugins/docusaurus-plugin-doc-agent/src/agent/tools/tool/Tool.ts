// ─── 类型 ───────────────────────────────────────────

import { Context } from '../../core/Context';
import type { ModelToolCall } from '../../model/Model';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ToolInput = JsonObject;
export type ToolOutput = string;
export type ToolPromptSchema = JsonObject;
export type ToolAskOutput = JsonValue;

/** 工具副作用事件，供 UI、日志、调度工具或父 agent 消费。 */
export interface ToolEvent {
    type: string;
    data?: JsonObject;
}

/** 工具向 Round 暴露的可聚合活动摘要，用于生成“浏览了 1 个文件夹、1 个文件”这类状态文案。 */
export interface ToolUsage {
    /** 动作动词，例如“浏览”“搜索”“修改”“运行”。 */
    verb: string;
    /** 被操作对象的显示名称，例如“文件”“文件夹”“网站”“命令”。 */
    name: string;
    /** 数量单位，例如“个”“条”“次”。 */
    unit: string;
    /** 工具已经知道明确数量时填写；适合搜索结果、批处理等一次调用产生多个对象的场景。 */
    count?: number;
    /** 可去重的目标标识；适合文件路径、目录路径、命令文本、URL 等单个目标。 */
    key?: string;
}

/** 工具对主上下文的修改请求，由 loop 统一应用。 */
export type ContextPatch =
    | { type: 'append'; context: Context }
    | { type: 'replace'; context: Context }
    | { type: 'compact'; context: Context; summary?: string };

/** 工具执行结果 */
export interface ToolResult {
    /** 返回给 model 的文本 */
    result: ToolOutput;
    /** 工具对主上下文的修改请求，例如压缩工具改写上下文。 */
    contextPatch?: ContextPatch;
    /** 可选的副作用事件，供 UI、日志或调度工具消费。 */
    events?: ToolEvent[];
    /** 工具完成后补充或修正的活动摘要；未提供时使用工具调用开始时的摘要。 */
    usage?: ToolUsage;
}

export interface ToolLabelContext {
    call?: ModelToolCall;
    input: ToolInput;
}

/** 工具执行上下文，由 loop 在调用时传入。 */
export interface ToolRunContext {
    /** 当前 loop 上下文的只读快照；需要修改时返回 contextPatch。 */
    context: Context;
    /** 由当前模型创建上下文消息，避免工具猜 provider payload 格式。 */
    /** 当前 loop 中全部工具的只读视图，调度工具可观察其他工具状态。 */
    tools: ReadonlyMap<string, Tool>;
    /** 工具执行控制器，调度工具可用它串行/并行运行工具。 */
    signal?: AbortSignal;
}

/** 工具定义，供 model 识别 */
export interface ToolDefinition {
    name: string;
    description: string;
    /** 工具的输入规范模式（JSON Schema格式），模型以此识别参数结构并生成工具指令 */
    prompt: ToolPromptSchema;
}

/**
 * 工具向 model 发起子询问的回调。
 *
 * 当工具遇到边界错误（上下文溢出、权限不足、歧义输入等），
 * 不是直接失败，而是通过此回调向 model 提问，由 model 决策后继续执行。
 *
 * 这是本架构的核心创新点：工具不再是被动的纯函数，
 * 而是具备「自主回问」能力的半自主协作者。
 */
export interface ToolAskPrompt<TInput extends JsonValue = JsonValue, TOutput extends ToolAskOutput = ToolAskOutput> {
    name: string;
    build(input: TInput): string;
    parse(content: string): TOutput;
}

export interface ToolAskRequest<TInput extends JsonValue = JsonValue, TOutput extends ToolAskOutput = ToolAskOutput> {
    input: TInput;
    prompt: ToolAskPrompt<TInput, TOutput>;
}

export type AskModel = <TInput extends JsonValue, TOutput extends ToolAskOutput>(
    request: ToolAskRequest<TInput, TOutput>,
) => Promise<TOutput>;

/** 工具状态 */
export type ToolStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

// ─── 基类 ───────────────────────────────────────────

export abstract class Tool {
    abstract name: string;
    abstract description: string;

    /** 工具的输入参数定义（采用 JSON Schema 格式），供 Model 识别并生成工具调用指令 */
    abstract prompt: ToolPromptSchema;

    /** 当前状态，供调度工具观察 */
    status: ToolStatus = 'idle';

    /** 暂停信号，子类在执行中检查 */
    protected pauseRequested = false;

    /** 子询问回调，由 loop 在执行前注入 */
    protected ask: AskModel | null = null;

    formatLabel(input: ToolInput, context: ToolLabelContext = { input }): string {
        return this.name;
    }

    abstract formatUsage(input: ToolInput, context: ToolLabelContext): ToolUsage;

    /**
     * 注入回问能力。
     * loop 在调用 execute 之前设置，使工具具备向 model 提问的通道。
     */
    setAsk(ask: AskModel): void {
        this.ask = ask;
    }

    /**
     * 执行工具。
     *
     * 子类实现具体逻辑。执行过程中可以：
     * - 通过 this.askModel() 向 model 发起子询问
     * - 通过 this.checkPause() 响应暂停请求
     * - 通过 this.status 暴露当前状态
     */
    async run(input: ToolInput, context: ToolRunContext = createEmptyToolRunContext()): Promise<ToolResult> {
        this.status = 'running';
        try {
            const result = await this.execute(input, context);
            this.status = 'done';
            return result;
        } catch (error) {
            this.status = 'error';
            throw error;
        }
    }

    /** 子类实现具体执行逻辑 */
    protected abstract execute(input: ToolInput, context: ToolRunContext): Promise<ToolResult>;

    // ─── 暂停/恢复 ─────────────────────────────────

    /** 外部请求暂停（调度工具 或 loop 调用） */
    pause(): void {
        this.pauseRequested = true;
        this.status = 'paused';
    }

    /** 外部请求恢复 */
    resume(): void {
        this.pauseRequested = false;
        this.status = 'running';
    }

    /**
     * 子类在长时间执行的关键节点调用此方法，
     * 检查是否需要暂停，实现协作式暂停。
     *
     * 示例：
     *   for (const chunk of data) {
     *       await this.checkPause();
     *       // 处理 chunk...
     *   }
     */
    protected async checkPause(): Promise<void> {
        while (this.pauseRequested) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    // ─── 自主回问 ─────────────────────────────────

    /**
     * 向 model 发起子询问。
     *
     * 当工具遇到边界情况时调用，不会中断顶层循环，
     * 也不会因为上下文不匹配被接口拒绝。
     *
     * 示例（压缩工具）：
     *   const answer = await this.askModel({
     *       prompt: this.compactPrompt,
     *       input: { reason: '上下文超出限制' },
     *   });
     *   // model 回答后，工具根据回答继续执行压缩
     */
    protected async askModel<TInput extends JsonValue, TOutput extends ToolAskOutput>(
        request: ToolAskRequest<TInput, TOutput>,
    ): Promise<TOutput> {
        if (!this.ask) {
            throw new Error(`Tool [${this.name}] 尝试回问 model，但未注入 ask 回调`);
        }
        return this.ask(request);
    }

    /** 导出工具定义，供 model 识别 */
    toDefinition(): ToolDefinition {
        return {
            name: this.name,
            description: this.description,
            prompt: this.prompt,
        };
    }
}

function createEmptyToolRunContext(): ToolRunContext {
    return {
        context: new Context(),
        tools: new Map(),
    };
}
