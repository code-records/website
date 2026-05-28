import React, { useState } from 'react';
import MarkdownRenderer from '../../doc-agent/ui/MarkdownRenderer.jsx';

const ACTION_TEXT_LIMIT = 600;

function getPrimaryPlan(message) {
    return Array.isArray(message?.plans) ? message.plans[0] : null;
}

function getRounds(message) {
    const plan = getPrimaryPlan(message);
    return Array.isArray(plan?.rounds) ? plan.rounds : [];
}

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
            existing.done = existing.done || action.done;
            existing.event = action.event || existing.event;
            existing.label = action.label || existing.label;
            existing.text = action.text || existing.text;
            continue;
        }

        const merged = { ...action, callId };
        toolById.set(callId, merged);
        result.push(merged);
    }

    return result.filter(Boolean);
}

function getPlanText(message) {
    return getRounds(message)
        .filter(round => round?.status === 'final' || round?.status === 'continue' || (round?.status === undefined && round?.isActive))
        .map(round => typeof round?.text === 'string' ? round.text : '')
        .join('');
}

function getElapsedSeconds(message) {
    const startedAt = Number(message?.startedAt || message?.createdAt || 0);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
    return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function actionLabel(action) {
    if (action?.type === 'tool') return action.label || action.call?.name || 'tool';
    if (action?.type === 'thinking') return 'thinking';
    if (action?.type === 'context') return action.label || 'context';
    if (action?.type === 'error') return action.label || 'error';
    return action?.label || action?.type || '';
}

function truncateActionText(text) {
    const value = typeof text === 'string' ? text.trim() : '';
    if (value.length <= ACTION_TEXT_LIMIT) return value;
    return `${value.slice(0, ACTION_TEXT_LIMIT).trimEnd()}...`;
}

function renderActionText(action) {
    const text = truncateActionText(action?.text);
    if (text.length > 0) return text;
    if (action?.type === 'tool') {
        const label = actionLabel(action);
        return label ? `${label}${action.done ? '' : ' ...'}` : '';
    }
    return '';
}

function buildSegments(message) {
    return getRounds(message).flatMap((round, roundIndex) => {
        const actions = normalizeActions(round?.actions);
        const actionSegments = actions
            .map((action, actionIndex) => ({
                key: `a-${roundIndex}-${action.callId || action.label || action.type || actionIndex}`,
                kind: 'action',
                text: renderActionText(action),
                type: action?.type,
            }))
            .filter(segment => segment.text.length > 0);

        const roundText = typeof round?.text === 'string' ? round.text.trim() : '';
        return [
            ...actionSegments,
            ...(roundText.length > 0
                ? [{ key: `r-${roundIndex}`, kind: 'round', text: roundText }]
                : []),
        ];
    });
}

function ThinkingLine({ message, isStreaming }) {
    if (!isStreaming) return null;
    const seconds = getElapsedSeconds(message);

    return (
        <div className="flex items-center gap-2 rounded-md bg-[var(--ifm-color-primary-lightest)]/40 px-2.5 py-1.5 text-xs text-[var(--ifm-color-primary)]">
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--ifm-color-primary)]" />
            <span>{seconds === null ? '思考中...' : `思考中（${seconds}秒）`}</span>
        </div>
    );
}

function ActionIcon({ type }) {
    if (type === 'error') {
        return (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
        );
    }

    if (type === 'context') {
        return (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                <path d="M14 2v6h6" />
                <path d="M8 13h8" />
                <path d="M8 17h5" />
            </svg>
        );
    }

    return (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.5-3.5a6 6 0 0 1-7.9 7.9l-6.4 6.4a2 2 0 0 1-2.8-2.8l6.4-6.4a6 6 0 0 1 7.9-7.9Z" />
        </svg>
    );
}

function AssistantIcon() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8V4H8" />
            <rect width="16" height="12" x="4" y="8" rx="3" />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M9 13h.01" />
            <path d="M15 13h.01" />
            <path d="M10 17h4" />
        </svg>
    );
}

function ActionSegment({ segment }) {
    const isError = segment.type === 'error';

    return (
        <div
            className={[
                'group flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 leading-relaxed transition-colors',
                isError
                    ? 'bg-red-500/5 text-red-600'
                    : 'bg-[var(--ifm-color-emphasis-100)] text-[var(--ifm-color-emphasis-700)] hover:bg-[var(--ifm-color-emphasis-200)]',
            ].filter(Boolean).join(' ')}
        >
            <span className="mt-0.5 shrink-0 opacity-70">
                <ActionIcon type={segment.type} />
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">
                {segment.text}
            </span>
        </div>
    );
}

function ActionList({ segments, isStreaming }) {
    if (!segments.length && !isStreaming) return null;

    return (
        <div className="rounded-lg border border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-background-color)]/70 p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--ifm-color-emphasis-600)]">
                    <svg className="h-3.5 w-3.5 text-[var(--ifm-color-primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 6h16" />
                        <path d="M4 12h10" />
                        <path d="M4 18h16" />
                    </svg>
                    <span>执行过程</span>
                </div>
                {isStreaming && (
                    <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--ifm-color-primary)]" />
                )}
            </div>
            <div className="grid max-h-40 gap-1 overflow-y-auto pr-0.5 thin-scrollbar">
                {segments.map(segment => (
                    <ActionSegment key={segment.key} segment={segment} />
                ))}
            </div>
        </div>
    );
}

function AnswerSegment({ segment }) {
    return (
        <div className="min-w-0 max-w-full rounded-lg bg-[var(--ifm-background-color)] px-3 py-2 text-sm leading-relaxed text-[var(--ifm-font-color-base)] break-words [overflow-wrap:anywhere]">
            <MarkdownRenderer content={segment.text} className="text-sm break-words [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
        </div>
    );
}

export default function CodeAssistantMessage({ message, isStreaming }) {
    const [copied, setCopied] = useState(false);
    const textRef = React.useRef(null);
    const segments = buildSegments(message);
    const actionSegments = segments.filter(segment => segment.kind === 'action');
    const answerSegments = segments.filter(segment => segment.kind === 'round');
    const content = getPlanText(message);
    const error = message.error || (message.isError && !content ? '生成失败，请稍后重试。' : '');
    const hasContent = answerSegments.length > 0 || !!error;

    const handleCopy = () => {
        const text = textRef.current?.innerText || content;
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        });
    };

    return (
        <div className="px-4 py-2 animate-[msg-fade-in_0.3s_ease-out]">
            <div className="flex w-full items-start gap-3">
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--ifm-color-primary-light)] bg-[var(--ifm-color-primary-lightest)] text-[var(--ifm-color-primary)] shadow-sm">
                    <AssistantIcon />
                </div>

                <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-color-emphasis-100)] shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
                    <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-background-color)]/80 px-3 py-2">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-[var(--ifm-font-color-base)]">CodeAgent</span>
                                <span className={[
                                    'rounded px-1.5 py-0.5 text-[10px] font-medium',
                                    isStreaming
                                        ? 'bg-[var(--ifm-color-primary-lightest)] text-[var(--ifm-color-primary)]'
                                        : error
                                            ? 'bg-red-500/10 text-red-600'
                                            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                                ].join(' ')}
                                >
                                    {isStreaming ? '生成中' : error ? '异常' : '已完成'}
                                </span>
                            </div>
                        </div>

                        {!isStreaming && content && (
                            <button
                                onClick={handleCopy}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-none bg-transparent p-0 text-[var(--ifm-color-emphasis-500)] transition-all hover:bg-[var(--ifm-color-emphasis-100)] hover:text-[var(--ifm-color-primary)] cursor-pointer"
                                title={copied ? '已复制' : '复制'}
                            >
                                {copied ? (
                                    <svg className="h-3.5 w-3.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                ) : (
                                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                    </svg>
                                )}
                            </button>
                        )}
                    </div>

                    <div ref={textRef} className="flex w-full flex-col gap-2.5 p-3">
                        <ThinkingLine message={message} isStreaming={isStreaming} />
                        <ActionList segments={actionSegments} isStreaming={isStreaming && actionSegments.length > 0} />

                        {hasContent && (
                            <div className="grid gap-2">
                                {answerSegments.map(segment => (
                                    <AnswerSegment key={segment.key} segment={segment} />
                                ))}

                                {!isStreaming && error && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-700 break-words">
                                        {error}
                                    </div>
                                )}
                            </div>
                        )}

                        {!hasContent && !actionSegments.length && !isStreaming && (
                            <div className="rounded-lg bg-[var(--ifm-background-color)] px-3 py-2 text-sm text-[var(--ifm-color-emphasis-600)]">
                                暂无可展示内容
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
