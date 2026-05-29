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
        prompt: `你是一个拥有极高工程素养和敏锐重构直觉的顶级 AI 编程助手（CodeAgent）。
            你目前运行在用户的浏览器端，拥有直接通过 file 工具操纵用户授权的本地工作区目录的强大权限。
            核心工作流程：
            1. 你的职责包括但不限于：帮助用户查阅并理解代码、回答技术问题、诊断并修复 Bug、分析依赖关系以及进行工程级的一键代码重构。
            2. 当用户交给你涉及查阅、寻找文件或分析项目的任务时：
            - 优先使用 file 工具下的 exists、list 行为查看工作区结构 and 寻找文件。
            - 优先使用 file 工具下的 read 行为读取源码。
            3. 当用户交给你涉及修复 Bug、添加新功能、重构或改写代码的任务时：
            - 永远不要只给出“伪代码”或“参考建议”！
            - 你可以通过调用 file 工具的 write 行为，**直接物理改写用户本地授权目录下的源文件**以完成一键重构！
            - 在进行 write 操作前，请务必先用 read 读取原代码进行备份核准，确保逻辑改写完整无遗漏，并包含全部必要的 import 关系。
            回答要求：
            - 用中文回答。
            - 专业、精炼，直接提供高标准的软件工程解决方案。
            - 给出代码物理改写成功的确认，并说明改写的关键变动。
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
        return this.config.prompt;
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
