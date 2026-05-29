import React, { useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer.jsx';

function flattenRoundActions(rounds) {
    return (Array.isArray(rounds) ? rounds : [])
        .flatMap(round => Array.isArray(round?.actions) ? round.actions : [])
        .filter(action => action?.type === 'tool');
}

function formatLabel(action) {
    return action?.label || action?.call?.name || '工具';
}

function getPlanContent(plans) {
    return (Array.isArray(plans) ? plans : [])
        .flatMap(plan => Array.isArray(plan?.rounds) ? plan.rounds : [])
        .filter(round => round?.status === 'final' || round?.status === 'continue' || (round?.status === undefined && round?.done !== true))
        .map(round => typeof round?.text === 'string' ? round.text : '')
        .join('');
}

function PlanItem({ plan, idx, onToggle, isLast, isCompleted, isError }) {
    const [localExpanded, setLocalExpanded] = useState(false);
    const scrollRef = React.useRef(null);
    const actions = flattenRoundActions(plan?.rounds);

    React.useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [actions.length]);

    const expanded = onToggle ? plan.expanded : localExpanded;
    const noItems = actions.length === 0;
    const failed = isError || plan?.status === 'failed';
    const label = failed
        ? '分析异常'
        : isCompleted && isLast && noItems
            ? '分析完毕，已生成回答'
            : (plan?.status === 'active' ? '正在工作' : '分析完毕');

    const handleClick = () => {
        if (onToggle) {
            onToggle(idx);
        } else {
            setLocalExpanded(value => !value);
        }
    };

    if (noItems) {
        return (
            <div className="flex items-center gap-1.5 px-2 min-h-7 py-0.5">
                <svg className={`w-3.5 h-3.5 ${failed ? 'text-red-500' : 'text-[var(--ifm-color-emphasis-600)]'} ${plan.status === 'active' ? 'animate-pulse' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                </svg>
                <span className={`text-xs ${failed ? 'text-red-500' : 'text-[var(--ifm-color-emphasis-600)]'}`}>{label}</span>
            </div>
        );
    }

    return (
        <div className="relative">
            <button
                type="button"
                onClick={handleClick}
                className="group flex items-center gap-1.5 w-full text-left text-sm px-2 min-h-7 py-0.5 rounded-lg select-none text-[var(--ifm-font-color-base)] hover:bg-[var(--ifm-color-emphasis-100)] transition-colors bg-transparent border-none cursor-pointer"
            >
                <svg className={`w-3.5 h-3.5 ${failed ? 'text-red-500' : 'text-[var(--ifm-color-emphasis-600)]'} ${plan.status === 'active' ? 'animate-pulse' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                </svg>
                <span className={`text-xs ${failed ? 'text-red-500' : 'text-[var(--ifm-color-emphasis-600)]'}`}>{label}</span>
                <svg className={`w-2.5 h-2.5 text-[var(--ifm-color-emphasis-600)] transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
                    <div 
                        ref={scrollRef}
                        className="flex flex-col gap-0.5 py-0.5 pl-6 pr-2 max-h-[110px] overflow-y-auto thin-scrollbar"
                    >
                        {actions.map((item, i) => (
                            <div key={i} className="text-xs text-[var(--ifm-color-emphasis-600)] py-0.5 shrink-0">
                                {formatLabel(item)}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}



export default function ChatMessage({ message, isStreaming, onTogglePlan }) {
    const [copied, setCopied] = useState(false);
    const textRef = React.useRef(null);
    const isUser = message.role === 'user';
    const plans = Array.isArray(message.plans) ? message.plans : [];
    const content = getPlanContent(plans);
    const error = message.error || (message.isError && !content ? '生成失败，请稍后重试。' : '');

    const handleCopy = () => {
        const text = textRef.current?.innerText || content;
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        });
    };

    if (isUser) {
        return (
            <div className="px-4 pt-4 pb-2 animate-[msg-fade-in_0.3s_ease-out]">
                <div className="bg-[var(--ifm-color-emphasis-100)] border border-[var(--ifm-color-emphasis-200)] p-3 rounded-xl">
                    <div className="whitespace-pre-wrap text-sm leading-relaxed break-words text-[var(--ifm-font-color-base)]">
                        {content}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="px-4 py-1.5 animate-[msg-fade-in_0.3s_ease-out]">
            <div className="flex flex-col gap-0.5 w-full">
                {plans.map((plan, idx) => (
                    <PlanItem
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
                        <span className="opacity-70">正在工作...</span>
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

