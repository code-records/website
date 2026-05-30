import {
    Agent,
    Message,
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
    suggestPrompt: string;
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
        suggestPrompt: `你是一个顶级 AI 编程专家。你需要根据用户当前连接授权的项目目录文件列表，动态生成 3 个最具工程深度、最贴近“测试 AI 编程与本地物理重构能力”的硬核推荐问题。
                    请把推荐方向彻底打开，不要局限于简单的概念提问，而是引导用户发出检验你“物理文件读写特长”的实战工程指令，例如：
                    1. 【深度 Bug 诊断与自动物理修复】：如“请全面扫描我们当前的核心逻辑源码，找出其中影响性能或存在安全隐患的 Bug，并直接物理重写修复它。”
                    2. 【核心代码重构与类型/架构强化】：如“帮我们挑选出一个最核心的代码文件，结合其语言特性（如强类型标注、性能重构）直接物理改写，进行高水准的架构重构。”
                    3. 【自动化单元测试落盘】：如“扫描我们的核心逻辑函数、类或组件，自动生成一套高质量的单元测试用例，并直接物理创建并写入对应的测试文件中。”
                    
                    要求：
                    - 结合用户当前的项目特征（如具体的开发语言、打包框架等）生成专属的硬核问题。
                    - 只输出推荐问题，每行一个问题，不要编号，不要解释。
                    - 最多输出 3 个问题。
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

    /**
     * 动态配置或注销本地工作区的 BrowserFileTool 物理代码读写工具
     */
    setDirectoryHandle(handle: FileSystemDirectoryHandle | null): void {
        this.tools = this.tools.filter(tool => tool.name !== 'file');
        if (handle) {
            this.tools.push(new BrowserFileTool(handle));
        }
    }

    /**
     * 根据授权获得的本地文件特征，动态由 AI 生成高准度的推荐问题
     */
    async suggestWorkspaceQuestions({ signal }: { signal?: AbortSignal } = {}): Promise<string | null> {
        const dev = true;
        if (dev) {
            const response = { content: '依赖关系梳理\n检测代码问题\n给出改进建议\n直接创作一篇完整的故事' };
            return dedupeSuggestionLines(response.content || '');
        }

        const fileTool = this.tools.find(t => t instanceof BrowserFileTool);
        if (!fileTool) return null;

        try {
            const listResult = await fileTool.run({ operation: 'list', path: '.' });
            const fileListStr = listResult.result || '';
            if (!fileListStr) return null;

            const runtimeModel = this.model;
            const response = await runtimeModel.complete({
                messages: [Message.user(`这是我当前项目的根目录文件列表：\n${fileListStr}`)],
                signal,
                system: this.config.suggestPrompt,
                toolChoice: 'none',
            });
            return dedupeSuggestionLines(response.content || '');
        } catch (e) {
            console.error('[CodeAgent] AI 动态推荐问题生成发生异常:', e);
            return null;
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

function dedupeSuggestionLines(content: string): string | null {
    const seen = new Set<string>();
    const lines = content
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
        .filter(line => {
            if (!line) return false;
            if (seen.has(line)) return false;
            seen.add(line);
            return true;
        })
    // .slice(0, 3);

    return lines.length > 0 ? lines.join('\n') : null;
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
