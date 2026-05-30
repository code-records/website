import React from 'react';
import {
    AgentResult,
    Context,
} from '../../../agent';
import { BrowserFileTool } from '../../../agent/tools/browser/BrowserFileTool';

const DEFAULT_CODE_SUGGESTIONS = [
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
            system: agent.config.suggestPrompt,
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
