import {
    Agent,
} from '../../agent';
import { BrowserFileTool } from '../../agent/tools/browser/BrowserFileTool';

export interface CodeAgentProviderConfig {
    adapter: 'openai';
    models: Record<string, string>;
    personalAccessToken?: string;
    streamUrl?: string;
    url?: string;
}

export interface CodeAgentConfig {
    compactKeepTail?: number;
    compactThreshold?: number;
    debug?: boolean;
    defaultModel: string;
    maxRounds?: number;
    prompt: string;
    providers: {
        openai: CodeAgentProviderConfig;
    };
    rules: string[];
    skills: string[];
}

export interface CodeAgentModelOption {
    id: string;
    label: string;
}

export class CodeAgent extends Agent {
    static instance = new CodeAgent();
    config: CodeAgentConfig = {
        maxRounds: Infinity,
        debug: true,
        compactThreshold: 28000,
        compactKeepTail: 4,
        defaultModel: 'qwen3.5-397b',
        providers: {
            openai: {
                adapter: 'openai' as const,
                personalAccessToken: ['sk', '-', 'oNbUJnjZlDJ3BEKrk8BqbBYOb7qK4kKIxJdrRJSAqtUHjO3j'].join(''),
                url: ['https://aicoding.', 'dobest', '.com/v1/responses'].join(''),
                streamUrl: ['https://aicoding.', 'dobest', '.com/v1/responses'].join(''),
                models: {
                    'qwen3.5-122b': 'Qwen3.5-122B',
                    'qwen3.5-397b': 'Qwen3.5-397B',
                    'minimaxm2.1': 'MiniMaxM2.1',
                    'minimaxm2.5': 'MiniMaxM2.5',
                    'glm-4.7': 'GLM-4.7',
                    'glm-5.1-local': 'GLM-5.1',
                    'kimi-k2.6-local': 'Kimi K2.6',
                },
            },
        },
        rules: [],
        skills: [],
        prompt: `你是一个拥有极高工程素养和敏锐重构直觉的顶级 AI 编程助手（CodeAgent）。
            你目前运行在用户的浏览器端，可以通过系统提供的 file 工具访问用户已授权的本地工作区目录。

            核心职责：
            1. 帮助用户查阅并理解代码、分析依赖关系、回答技术问题、诊断并修复 Bug，以及执行工程级代码重构。
            2. 当任务涉及查阅、寻找文件、分析项目结构或理解依赖关系时，优先使用 file 工具探索工作区，再基于真实结果回答。
            3. 当任务涉及修复 Bug、添加功能、重构或改写代码时，不要只给伪代码或泛泛建议；需要修改文件时，使用 file 工具写入真实文件。

            file 工具调用规则：
            - 需要访问文件系统时，必须通过系统的结构化工具调用通道调用 file 工具，不要把工具参数写在普通正文里。
            - file 工具参数必须同时包含 operation 和 path。operation 只能是 list、read、exists、stat、write、delete 之一。
            - 查看目录使用 operation=list；读取文件使用 operation=read；写入文件使用 operation=write 且必须提供完整 content。
            - 根目录路径使用 "."。不要只输出 {"path":"."} 这类不完整 JSON；这不是有效工具调用。
            - 如果工具调用失败，先根据错误调整下一次结构化工具调用；不要在正文中伪造工具调用、伪造工具结果或反复输出 JSON。
            - 不要连续重复调用同一个无效路径。路径不存在时，回到上级目录 list，或换用更明确的候选路径。

            工作方式：
            - 用户已经给出明确任务时，直接推进任务，不要反复询问“您需要什么帮助”。
            - 探索项目时先 list 根目录，再读取关键配置文件和源码文件，例如 package.json、tsconfig、入口文件、README、模块索引等。
            - 在掌握足够上下文前，不要编造项目结构、依赖关系或文件内容。
            - 修改代码前先 read 原文件；写入时保证内容完整、导入关系完整、不会遗漏原有必要逻辑。

            回答要求：
            - 用中文回答。
            - 专业、精炼，直接给出高标准的软件工程结论或改动说明。
            - 如果完成了文件修改，明确说明改了哪些文件和关键变化。
            - 如果无法继续是因为工具不可用或权限不足，清楚说明阻塞原因和需要用户执行的具体动作。
            `,
    };
    currentModelId = this.config.defaultModel;
    model = createCodeAgentModel(this.config);
    name = 'code_agent';
    tools: any[] = []; // 动态注入 BrowserFileTool

    constructor() {
        super({
            toolTimeoutMs: 15000,
        });
        this.context.maxRounds = this.config.maxRounds;
    }

    get systemPrompt(): string {
        return buildCodeAgentSystemPrompt(this.config);
    }

    setCurrentModel(model: string): void {
        const modelId = this.resolveModelId(model);
        this.currentModelId = modelId;
        this.changeModel(createCodeAgentModel(this.config, modelId));
    }

    get defaultModelId(): string {
        return this.config.defaultModel;
    }

    get modelOptions(): CodeAgentModelOption[] {
        return Object.entries(this.config.providers.openai.models)
            .map(([id, label]) => ({ id, label: String(label) }));
    }

    resolveModelId(model?: string): string {
        const models = this.config.providers.openai.models;
        if (model && Object.prototype.hasOwnProperty.call(models, model)) {
            return model;
        }
        return this.defaultModelId;
    }

    setDirectoryHandle(handle: FileSystemDirectoryHandle | null): void {
        this.tools = this.tools.filter(tool => tool.name !== 'file');
        if (handle) {
            this.tools.push(new BrowserFileTool(handle));
        }
    }

}

function buildCodeAgentSystemPrompt(config: CodeAgentConfig): string {
    return [
        config.prompt,
        formatPromptSection('规则', config.rules),
        formatPromptSection('技能', config.skills),
    ].filter(Boolean).join('\n\n');
}

function formatPromptSection(title: string, items: string[]): string {
    const content = items
        .map(item => item.trim())
        .filter(Boolean)
        .join('\n\n');
    return content.length > 0 ? `${title}：\n${content}` : '';
}

export function createCodeAgentModel(config: CodeAgentConfig, model = config.defaultModel) {
    const provider = config.providers.openai;
    const apiModel = provider.models[model as keyof typeof provider.models];
    if (!apiModel) {
        throw new Error(`Unknown code-agent model: ${model}`);
    }

    return Agent.createModel({
        adapter: provider.adapter,
        model: apiModel,
        personalAccessToken: provider.personalAccessToken,
        streamUrl: provider.streamUrl,
        url: provider.url,
    });
}
