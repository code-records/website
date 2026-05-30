import React from 'react';
import {
    AgentResult,
    Context,
} from '../../../agent';
import { BrowserFileTool } from '../../../agent/tools/browser/BrowserFileTool';

const SUGGEST_PROMPT = `你是一个顶级 AI 编程专家。你需要根据用户当前连接授权的项目目录文件列表，动态生成 3 个最具工程深度、最贴近“测试 AI 编程与本地物理重构能力”的硬核推荐问题。
                    请把推荐方向彻底打开，不要局限于简单的概念提问，而是引导用户发出检验你“物理文件读写特长”的实战工程指令，例如：
                    1. 【深度 Bug 诊断与自动物理修复】：如“请全面扫描我们当前的核心逻辑源码，找出其中影响性能或存在安全隐患的 Bug，并直接物理重写修复它。”
                    2. 【核心代码重构与类型/架构强化】：如“帮我们挑选出一个最核心的代码文件，结合其语言特性（如强类型标注、性能重构）直接物理改写，进行高水准的架构重构。”
                    3. 【自动化单元测试落盘】：如“扫描我们的核心逻辑函数、类或组件，自动生成一套高质量的单元测试用例，并直接物理创建并写入对应的测试文件中。”
                    
                    要求：
                    - 结合用户当前的项目特征（如具体的开发语言、打包框架等）生成专属的硬核问题。
                    - 只输出推荐问题，每行一个问题，不要编号，不要解释。
                    - 最多输出 3 个问题。
                    `;

const DEFAULT_CODE_SUGGESTIONS = [
    '输出当前项目结构',
    '梳理依赖关系',
    '检测代码问题',
    '给出改进建议',
    '直接创作一篇完整的故事',
];

const dev = true;

async function suggestWorkspaceQuestions(agent, { signal } = {}) {
    if (dev) return DEFAULT_CODE_SUGGESTIONS.join('\n');

    const fileTool = agent?.tools?.find(tool => tool instanceof BrowserFileTool);
    if (!fileTool) return null;

    try {
        const listResult = await fileTool.run({ operation: 'list', path: '.' });
        const fileListStr = listResult.result || '';
        if (!fileListStr) return null;

        const response = await agent.model.complete({
            context: Context.from(`这是我当前项目的根目录文件列表：\n${fileListStr}`),
            result: new AgentResult(),
            signal,
            system: SUGGEST_PROMPT,
        });
        return dedupeSuggestionLines(response.content || '');
    } catch (e) {
        if (isAbortError(e)) return null;
        console.error('[CodeAgent] AI 动态推荐问题生成发生异常:', e);
        return null;
    }
}

export default function SuggestMessage({ agent, directoryHandle, workspaceFiles, onSelectSuggestion }) {
    const [suggestions, setSuggestions] = React.useState([]);
    const loadedKeyRef = React.useRef('');

    React.useEffect(() => {
        if (dev) {
            setSuggestions(DEFAULT_CODE_SUGGESTIONS);
            return;
        }

        const key = getWorkspaceSuggestionKey(directoryHandle, workspaceFiles);
        if (!key || loadedKeyRef.current === key) return;
        loadedKeyRef.current = key;

        let active = true;

        suggestWorkspaceQuestions(agent).then(text => {
            if (!active) return;
            setSuggestions(splitSuggestionLines(text));
        }).catch(e => {
            if (!isAbortError(e)) {
                console.error('[CodeAgent] AI 动态推荐问题生成发生异常:', e);
            }
        });

        return () => {
            active = false;
        };
    }, [agent, directoryHandle, workspaceFiles]);

    const items = suggestions;
    if (!items.length) return null;

    return (
        <div className="mb-3 rounded-lg border border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-background-color)] p-2">
            <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-medium text-[var(--ifm-color-emphasis-600)]">
                <svg className="h-3.5 w-3.5 text-[var(--ifm-color-primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v3" />
                    <path d="M12 18v3" />
                    <path d="m4.22 4.22 2.12 2.12" />
                    <path d="m17.66 17.66 2.12 2.12" />
                    <path d="M3 12h3" />
                    <path d="M18 12h3" />
                    <path d="m4.22 19.78 2.12-2.12" />
                    <path d="m17.66 6.34 2.12-2.12" />
                </svg>
                <span>推荐问题</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {items.map((item, idx) => (
                    <button
                        key={`${item}-${idx}`}
                        type="button"
                        onClick={() => onSelectSuggestion?.(item)}
                        className="group flex items-center gap-1.5 rounded-md border border-transparent bg-[var(--ifm-color-emphasis-100)] px-2.5 py-1.5 text-left text-[11px] leading-snug text-[var(--ifm-font-color-base)] cursor-pointer transition-colors hover:border-[var(--ifm-color-primary)] hover:bg-[var(--ifm-background-color)] hover:text-[var(--ifm-color-primary)]"
                    >
                        <span>{item}</span>
                        <svg className="h-3 w-3 shrink-0 opacity-40 transition-transform group-hover:translate-x-0.5 group-hover:opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14" />
                            <path d="m13 6 6 6-6 6" />
                        </svg>
                    </button>
                ))}
            </div>
        </div>
    );
}

function dedupeSuggestionLines(content) {
    const seen = new Set();
    const lines = content
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
        .filter(line => {
            if (!line) return false;
            if (seen.has(line)) return false;
            seen.add(line);
            return true;
        });

    return lines.length > 0 ? lines.join('\n') : null;
}

function splitSuggestionLines(content) {
    if (!content) return [];
    return content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function isAbortError(error) {
    return error?.name === 'AbortError';
}

function getWorkspaceSuggestionKey(directoryHandle, workspaceFiles) {
    if (!directoryHandle || !workspaceFiles?.length) return '';
    return workspaceFiles
        .map(item => `${item.kind}:${item.name}`)
        .sort()
        .join('|');
}
