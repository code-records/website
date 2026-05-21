import { Agent, ClaudeModel, GeminiModel, OpenAIModel, type Model, type ModelMessage } from '../agent';
import { DOC_AGENT_TOOLS } from './tools/index';
import { readDocByUrl } from './tools/ReadDocTool';
import type { MessageJSON } from '../agent';
import type { ModelOption } from './modelOptions';

const SUGGEST_SURFACE_ID = 'message-docs-suggestions';
const SUGGESTIONS_DELETE_MESSAGE = {
    version: 'v0.9',
    deleteSurface: { surfaceId: SUGGEST_SURFACE_ID },
};

let docAgentSitePrompt: string | undefined;

export const DOC_AGENT_EXECUTION_PROMPT = `文档仓库根目录为 {{docsRoot}}，所有文档 URL 以 /{{docsRoot}}/ 开头。

基本流程：
1. 问题范围足够时，先用 search_docs 搜索，再用 read_doc 读取相关文档。
2. 调用 search_docs 时使用空格分隔关键词，不要直接搜索完整句子，例如：\`微信 小游戏 支付 回调\`。
3. 需要多篇文档时，可在同一轮对多个 URL 分别调用 read_doc，系统会并发读取。
4. 首次无结果或结果不匹配时，换平台、功能、错误码、接口名等关键词组合再试。
5. 需要了解项目结构或查找文档位置时，用 browse_tree 浏览目录。路径相对于仓库根，如 browse_tree("{{docsRoot}}") 或 browse_tree("{{docsRoot}}/platforms")。

回答要求：
- 只基于读到的文档回答；资料不足时说明缺口并追问，不要凭记忆补全。
- 需要列参考时，在末尾用 Markdown 链接，URL 必须且只能输出相对路径（如 /{{docsRoot}}/...），不要编造或携带任何域名。

兜底规则：
- 搜索或读取失败时如实说明，不要用乐观措辞掩饰。`;

export const DOC_AGENT_PROMPT = DOC_AGENT_EXECUTION_PROMPT;

export interface DocAgentConfig {
    baseUrl?: string;
    compactKeepTail?: number;
    compactThreshold?: number;
    debug?: boolean;
    maxRounds?: number;
    systemPrompt?: string;
}

function getDocsRootFromPathname(): string {
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    return pathname.split('/').filter(Boolean)[0] || '';
}

export function buildDocAgentPrompt({
    docsRoot = getDocsRootFromPathname(),
    sitePrompt = docAgentSitePrompt,
}: {
    docsRoot?: string;
    sitePrompt?: string;
} = {}): string {
    const executionPrompt = docsRoot
        ? DOC_AGENT_EXECUTION_PROMPT.replaceAll('{{docsRoot}}', docsRoot)
        : DOC_AGENT_EXECUTION_PROMPT;

    return [
        sitePrompt,
        executionPrompt,
    ].filter(Boolean).join('\n\n');
}

export const DOC_AGENT_CONFIG: DocAgentConfig = {
    maxRounds: Infinity,
    debug: true,
    compactThreshold: 28000,
    compactKeepTail: 4,
    baseUrl: '/',
    get systemPrompt() {
        return buildDocAgentPrompt();
    },
};

export const SUGGEST_PROMPT = `根据以下文档内容，生成 3 个用户最可能想问的推荐问题。
只输出推荐问题，每行一个问题，不要编号，不要解释。`;

export class DocAgent extends Agent {
    static instance = new DocAgent();
    config = DOC_AGENT_CONFIG;
    name = 'doc_agent';
    suggestionsDeleteMessage: typeof SUGGESTIONS_DELETE_MESSAGE;
    tools = DOC_AGENT_TOOLS;

    constructor() {
        super({
            maxRounds: DOC_AGENT_CONFIG.maxRounds,
            model: createDocAgentModel({
                adapterType: 'openai',
                model: '',
            }),
            toolTimeoutMs: 15000,
        });

        this.suggestionsDeleteMessage = SUGGESTIONS_DELETE_MESSAGE;
    }

    get instructions(): string {
        return this.config.systemPrompt ?? buildDocAgentPrompt();
    }

    get sitePrompt(): string | undefined {
        return docAgentSitePrompt;
    }

    configure(pluginOptions: { prompt?: string }): void {
        docAgentSitePrompt = pluginOptions.prompt;
    }

    setModelOption(modelOption: ModelOption): void {
        this.setModel(createDocAgentModel(modelOption));
    }

    async suggestQuestions({
        modelOption,
        a2uiPromptText,
        pathname,
        signal,
    }: {
        modelOption: ModelOption;
        a2uiPromptText?: string;
        pathname: string;
        signal?: AbortSignal;
    }): Promise<MessageJSON | null> {
        if (typeof pathname !== 'string' || !pathname.startsWith('/')) return null;

        const url = pathname.replace(/\/$/, '');
        let content: string | null = null;
        try {
            ({ content } = await readDocByUrl(url));
            if (!content && pathname !== url) {
                ({ content } = await readDocByUrl(pathname));
            }
        } catch {
            return null;
        }
        if (!content) return null;

        const model = createDocAgentModel(modelOption);
        const response = await model.complete({
            messages: [model.createUserMsg(content.slice(0, 3000))],
            signal,
            system: [SUGGEST_PROMPT, a2uiPromptText].filter(Boolean).join('\n\n'),
            toolChoice: 'none',
        });

        const responseContent = response.content;

        if (!responseContent) return null;

        return {
            role: 'assistant',
            content: responseContent,
            local: true,
            custom: 'suggest',
        };
    }

    bindRouteChange({
        getPathname,
        onChange,
    }: {
        getPathname?: () => string;
        onChange?: (pathname: string) => void;
    }): () => void {
        const currentPathname = () => getPathname?.() || window.location.pathname;
        let lastPath = currentPathname();
        const handler = () => {
            const currentPath = currentPathname();
            if (currentPath === lastPath) return;
            lastPath = currentPath;
            onChange?.(currentPath);
        };

        window.addEventListener('popstate', handler);
        const origPush = window.history.pushState;
        const origReplace = window.history.replaceState;
        window.history.pushState = function (...args) {
            origPush.apply(this, args);
            handler();
        };
        window.history.replaceState = function (...args) {
            origReplace.apply(this, args);
            handler();
        };

        return () => {
            window.removeEventListener('popstate', handler);
            window.history.pushState = origPush;
            window.history.replaceState = origReplace;
        };
    }
}

export function createDocAgentModel(modelOption: ModelOption): Model {
    const config = {
        endpoint: modelOption.endpoint,
        model: modelOption.model,
    };

    if (modelOption.adapterType === 'openai') return new OpenAIModel(config);
    if (modelOption.adapterType === 'anthropic') return new ClaudeModel(config);
    if (modelOption.adapterType === 'gemini') return new GeminiModel(config);

    throw new Error(`Unknown adapter type: ${String(modelOption.adapterType)}`);
}

export function createDocAgentUserMessage(model: Model, content: string): ModelMessage {
    return model.createUserMsg(content);
}
