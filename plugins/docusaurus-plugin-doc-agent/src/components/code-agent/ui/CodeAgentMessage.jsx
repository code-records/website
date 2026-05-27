import React, { useState } from 'react';
import MarkdownRenderer from '../../doc-agent/ui/MarkdownRenderer.jsx';

const ACTION_META = {
    thinking: {
        badge: '分析',
        className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
        dotClassName: 'bg-amber-500',
        title: '模型分析',
    },
    tool: {
        badge: '工具',
        className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20',
        dotClassName: 'bg-sky-500',
        title: '工具调用',
    },
    context: {
        badge: '上下文',
        className: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20',
        dotClassName: 'bg-violet-500',
        title: '上下文更新',
    },
    error: {
        badge: '异常',
        className: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20',
        dotClassName: 'bg-red-500',
        title: '执行异常',
    },
};

function normalizeActions(actions) {
    const result = [];
    const toolById = new Map();

    for (const action of Array.isArray(actions) ? actions : []) {
        if (!action || action.type !== 'tool') {
            result.push(action);
            continue;
        }

        const callId = action.callId || action.call?.id;
        if (!callId) {
            result.push(action);
            continue;
        }

        const existing = toolById.get(callId);
        if (existing) {
            existing.callId = existing.callId || action.callId;
            existing.call = action.call || existing.call;
            existing.content = action.content || existing.content;
            existing.done = existing.done || action.done;
            existing.event = action.event || existing.event;
            existing.label = action.label || existing.label;
            continue;
        }

        const merged = { ...action, callId };
        toolById.set(callId, merged);
        result.push(merged);
    }

    return result.filter(Boolean);
}

function getRoundActionCount(plan) {
    return (Array.isArray(plan?.rounds) ? plan.rounds : [])
        .reduce((total, round) => total + normalizeActions(round?.actions).length, 0);
}

function formatRoundName(index) {
    const names = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    return `第${names[index] || index + 1}轮`;
}

function clipText(value, maxLength = 1200) {
    const text = String(value || '').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}\n...`;
}

function formatValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch (error) {
        return String(value);
    }
}

function getActionMeta(action) {
    return ACTION_META[action?.type] || {
        badge: action?.type || '步骤',
        className: 'bg-[var(--ifm-color-emphasis-100)] text-[var(--ifm-color-emphasis-700)] border-[var(--ifm-color-emphasis-200)]',
        dotClassName: 'bg-[var(--ifm-color-emphasis-400)]',
        title: action?.label || '执行步骤',
    };
}

function getActionTitle(action) {
    if (action?.type === 'tool') {
        return action.label || action.call?.name || 'tool';
    }
    if (action?.type === 'context') {
        return action.label || '更新上下文';
    }
    if (action?.type === 'error') {
        return action.label || '异常';
    }
    return action?.label || getActionMeta(action).title;
}

function ActionStatus({ action }) {
    if (!action || action.type !== 'tool') return null;

    return (
        <span className={`ml-auto shrink-0 text-[10px] ${action.done ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--ifm-color-emphasis-500)]'}`}>
            {action.done ? '完成' : '运行中'}
        </span>
    );
}

function ActionBlock({ label, children }) {
    if (!children) return null;

    return (
        <div className="mt-1.5">
            <div className="mb-1 text-[10px] font-bold text-[var(--ifm-color-emphasis-500)]">{label}</div>
            <pre className="m-0 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--ifm-color-emphasis-100)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--ifm-color-emphasis-700)] thin-scrollbar">
                {children}
            </pre>
        </div>
    );
}

function ToolActionBody({ action }) {
    const input = formatValue(action.call?.input);
    const result = formatValue(action.content);
    const event = formatValue(action.event);

    if (!input && !result && !event) return null;

    return (
        <div className="mt-2 border-t border-[var(--ifm-color-emphasis-200)] pt-2">
            <ActionBlock label="输入">{clipText(input, 900)}</ActionBlock>
            <ActionBlock label="结果">{clipText(result, 1200)}</ActionBlock>
            <ActionBlock label="事件">{clipText(event, 900)}</ActionBlock>
        </div>
    );
}

function TextActionBody({ action }) {
    const content = clipText(action.content, 1200);
    if (!content) return null;

    return (
        <div className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--ifm-color-emphasis-700)]">
            {content}
        </div>
    );
}

function ActionItem({ action }) {
    const meta = getActionMeta(action);

    return (
        <div className="relative pl-4">
            <span className={`absolute left-0 top-3 h-1.5 w-1.5 rounded-full ${meta.dotClassName}`} />
            <div className="rounded-md border border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-background-color)] px-2.5 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ${meta.className}`}>
                        {meta.badge}
                    </span>
                    <span className="min-w-0 truncate text-xs font-medium text-[var(--ifm-font-color-base)]">
                        {getActionTitle(action)}
                    </span>
                    <ActionStatus action={action} />
                </div>
                {action.type === 'tool' ? (
                    <ToolActionBody action={action} />
                ) : (
                    <TextActionBody action={action} />
                )}
            </div>
        </div>
    );
}

function RoundItem({ round, index }) {
    const actions = normalizeActions(round?.actions);
    if (actions.length === 0) return null;

    return (
        <div className="relative pl-4">
            <div className="absolute left-[3px] top-5 bottom-1 w-px bg-[var(--ifm-color-emphasis-200)]" />
            <div className="mb-1.5 flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${round?.isActive ? 'animate-pulse bg-[var(--ifm-color-primary)]' : 'bg-[var(--ifm-color-emphasis-400)]'}`} />
                <span className="text-xs font-bold text-[var(--ifm-font-color-base)]">
                    {formatRoundName(index)}：
                </span>
                <span className="text-[10px] text-[var(--ifm-color-emphasis-500)]">
                    {round?.isActive ? '进行中' : '完成'}
                </span>
            </div>
            <div className="flex flex-col gap-2">
                {actions.map((action, actionIndex) => (
                    <ActionItem key={`${action.type}-${action.callId || action.label || 'action'}-${actionIndex}`} action={action} />
                ))}
            </div>
        </div>
    );
}

function PlanTrace({ plan, idx, onToggle, isLast, isCompleted, isError }) {
    const [localExpanded, setLocalExpanded] = useState(true);
    const scrollRef = React.useRef(null);
    const rounds = Array.isArray(plan?.rounds) ? plan.rounds : [];
    const actionCount = getRoundActionCount(plan);
    const hasTrace = rounds.length > 0 && actionCount > 0;

    React.useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [actionCount]);

    if (!hasTrace && !plan?.label) return null;

    const failed = isError || plan?.status === 'failed';
    const expanded = onToggle ? (plan.expanded || plan.isActive) : localExpanded;
    const label = failed
        ? '分析异常'
        : plan?.isActive
            ? '正在分析...'
            : isCompleted && isLast
                ? '分析完毕，已生成回答'
                : plan?.label || '分析中';

    const handleClick = () => {
        if (onToggle && !plan?.isActive) {
            onToggle(idx);
        } else {
            setLocalExpanded(value => !value);
        }
    };

    return (
        <div className="mx-1 mb-2 overflow-hidden rounded-lg border border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-color-emphasis-50)]">
            <button
                type="button"
                onClick={handleClick}
                className="flex w-full items-center gap-2 border-none bg-transparent px-3 py-2 text-left cursor-pointer hover:bg-[var(--ifm-color-emphasis-100)] transition-colors"
            >
                <svg className={`h-3.5 w-3.5 ${failed ? 'text-red-500' : 'text-[var(--ifm-color-primary)]'} ${plan?.isActive ? 'animate-pulse' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                </svg>
                <span className={`text-xs font-bold ${failed ? 'text-red-500' : 'text-[var(--ifm-font-color-base)]'}`}>
                    {label}
                </span>
                <span className="ml-auto text-[10px] text-[var(--ifm-color-emphasis-500)]">
                    {rounds.length} 轮 / {actionCount} 步
                </span>
                <svg className={`h-3 w-3 text-[var(--ifm-color-emphasis-500)] transition-transform ${expanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </button>
            <div
                className="grid transition-[grid-template-rows,opacity] duration-200"
                style={{
                    gridTemplateRows: expanded ? '1fr' : '0fr',
                    opacity: expanded ? 1 : 0,
                }}
            >
                <div className="overflow-hidden">
                    <div ref={scrollRef} className="max-h-96 overflow-y-auto border-t border-[var(--ifm-color-emphasis-200)] px-3 py-3 thin-scrollbar">
                        <div className="flex flex-col gap-3">
                            {rounds.map((round, roundIndex) => (
                                <RoundItem key={roundIndex} round={round} index={roundIndex} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function CodeAgentMessage({ message, isStreaming, onTogglePlan }) {
    const [copied, setCopied] = useState(false);
    const textRef = React.useRef(null);
    const content = typeof message.content === 'string' ? message.content : '';
    const error = message.error || (message.isError && !content ? '生成失败，请稍后重试。' : '');
    const plans = Array.isArray(message.plans) ? message.plans : [];

    const handleCopy = () => {
        const text = textRef.current?.innerText || content;
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        });
    };

    return (
        <div className="px-4 py-1.5 animate-[msg-fade-in_0.3s_ease-out]">
            <div className="flex flex-col gap-0.5 w-full">
                {plans.map((plan, idx) => (
                    <PlanTrace
                        key={idx}
                        plan={plan}
                        idx={idx}
                        onToggle={onTogglePlan}
                        isLast={idx === plans.length - 1}
                        isCompleted={!isStreaming}
                        isError={!!message.isError}
                    />
                ))}

                {isStreaming && !content && plans.length === 0 && (
                    <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-[var(--ifm-color-emphasis-600)]">
                        <svg className="w-3.5 h-3.5 opacity-70 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                        </svg>
                        <span className="opacity-70">正在分析...</span>
                    </div>
                )}

                {content && (
                    <div ref={textRef} className="leading-relaxed py-1 px-1 w-full overflow-hidden">
                        <MarkdownRenderer content={content} className="text-sm break-words" />
                    </div>
                )}

                {!isStreaming && error && (
                    <div className="mx-1 my-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-700 break-words">
                        {error}
                    </div>
                )}

                {!isStreaming && content && (
                    <div className="flex justify-end px-1">
                        <button
                            onClick={handleCopy}
                            className="flex items-center gap-1 bg-transparent border-none cursor-pointer opacity-50 hover:opacity-100 transition-opacity p-1"
                            title="复制"
                        >
                            {copied ? (
                                <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            ) : (
                                <svg className="w-3.5 h-3.5 text-[var(--ifm-color-emphasis-500)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                            )}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
