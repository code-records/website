import {
    Agent,
    ClaudeModel,
    GeminiModel,
    Message,
    OpenAIModel,
    type Model,
} from '../../agent';
import type { DocAgentPluginOptions, DocAgentProviderOption, DocAgentProviders } from '../../index';
import { BrowserFileTool } from '../../agent/tools/browser/BrowserFileTool';

let codeAgentSitePrompt: string | undefined;
let codeAgentProviders: DocAgentProviders = {};

export const CODE_AGENT_SYSTEM_PROMPT = `你是一个拥有极高工程素养和敏锐重构直觉的顶级 AI 编程助手（CodeAgent）。
你目前运行在用户的浏览器端，拥有直接通过 file 工具操纵用户授权的本地工作区目录的强大权限。

核心工作流程：
1. 你的职责包括但不限于：帮助用户查阅并理解代码、回答技术问题、诊断并修复 Bug、分析依赖关系以及进行工程级的一键代码重构。
2. 当用户交给你涉及查阅、寻找文件或分析项目的任务时：
   - 优先使用 file 工具下的 exists、list 行为查看工作区结构和寻找文件。
   - 优先使用 file 工具下的 read 行为读取源码。
3. 当用户交给你涉及修复 Bug、添加新功能、重构或改写代码的任务时：
   - 永远不要只给出“伪代码”或“参考建议”！
   - 你可以通过调用 file 工具的 write 行为，**直接物理改写用户本地授权目录下的源文件**以完成一键重构！
   - 在进行 write 操作前，请务必先用 read 读取原代码进行备份核准，确保逻辑改写完整无遗漏，并包含全部必要的 import 关系。

回答要求：
- 专业、精炼，直接提供高标准的软件工程解决方案。
- 给出代码物理改写成功的确认，并说明改写的关键变动。
`;

export interface CodeAgentConfig {
    compactKeepTail?: number;
    compactThreshold?: number;
    debug?: boolean;
    maxRounds?: number;
    systemPrompt?: string;
}

export const CODE_AGENT_CONFIG: CodeAgentConfig = {
    maxRounds: Infinity,
    debug: true,
    compactThreshold: 28000,
    compactKeepTail: 4,
    get systemPrompt() {
        return [codeAgentSitePrompt, CODE_AGENT_SYSTEM_PROMPT].filter(Boolean).join('\n\n');
    },
};

export class CodeAgent extends Agent {
    static instance = new CodeAgent();
    config = CODE_AGENT_CONFIG;
    name = 'code_agent';
    tools: any[] = []; // 动态注入 BrowserFileTool

    constructor() {
        super({
            maxRounds: CODE_AGENT_CONFIG.maxRounds,
            model: new OpenAIModel({ model: '' }),
            toolTimeoutMs: 15000,
        });
    }

    get instructions(): string {
        return this.config.systemPrompt ?? CODE_AGENT_SYSTEM_PROMPT;
    }

    configure(pluginOptions: Pick<DocAgentPluginOptions, 'prompt' | 'providers'>): void {
        codeAgentSitePrompt = pluginOptions.prompt;
        codeAgentProviders = pluginOptions.providers;
    }

    setCurrentModel(model: string): void {
        this.setModel(createCodeAgentModel(model));
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
    async suggestWorkspaceQuestions({
        model,
        files,
        signal,
    }: {
        model: string;
        files: string[];
        signal?: AbortSignal;
    }): Promise<string | null> {
        if (!files || files.length === 0) return null;

        const runtimeModel = createCodeAgentModel(model);
        const fileListStr = files.join('\n');

        const systemPrompt = `你是一个顶级 AI 编程助手。你需要根据用户当前授权连接的本地项目根目录下的部分文件列表，动态生成 3 个最贴切该项目、也是用户可能最想问的代码查阅、分析或重构的推荐问题。
例如：如果列表包含 package.json，你可以推荐“帮我诊断一下项目的依赖版本”；如果包含 rollup.config.js，可以推荐“帮我分析这个打包配置”。
要求：
- 只输出推荐问题，每行一个问题，不要编号，不要解释。
- 最多输出 3 个问题。`;

        try {
            const response = await runtimeModel.complete({
                messages: [Message.user(`这是我当前项目的根目录文件列表：\n${fileListStr}`)],
                signal,
                system: systemPrompt,
                toolChoice: 'none',
            });
            return response.content || null;
        } catch (e) {
            console.error('[CodeAgent] AI 动态推荐问题生成发生异常:', e);
            return null;
        }
    }
}

function getProviderByModel(model: string): DocAgentProviderOption {
    for (const provider of Object.values(codeAgentProviders)) {
        if (Object.prototype.hasOwnProperty.call(provider.models, model)) return provider;
    }
    throw new Error(`Unknown model: ${model}`);
}

export function createCodeAgentModel(model: string): Model {
    const provider = getProviderByModel(model);
    const config = {
        model,
        personalAccessToken: provider.personalAccessToken,
    };

    if (provider.adapter === 'openai') return new OpenAIModel(config);
    if (provider.adapter === 'anthropic') return new ClaudeModel(config);
    if (provider.adapter === 'gemini') return new GeminiModel(config);

    throw new Error(`Unknown adapter type: ${String(provider.adapter)}`);
}
