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
        <div className="px-1 py-0.5 text-xs text-[var(--ifm-color-emphasis-600)]">
            {seconds === null ? '思考中...' : `思考中（${seconds}秒）`}
        </div>
    );
}

function Segment({ segment }) {
    const isAction = segment.kind === 'action';
    const isError = segment.type === 'error';

    return (
        <div
            className={[
                'min-w-0 max-w-full px-1 py-0.5 leading-relaxed break-words [overflow-wrap:anywhere]',
                isAction ? 'overflow-hidden text-xs text-[var(--ifm-color-emphasis-600)] whitespace-pre-wrap' : 'text-sm text-[var(--ifm-font-color-base)]',
                isError ? 'text-red-600' : '',
            ].filter(Boolean).join(' ')}
        >
            {isAction ? segment.text : <MarkdownRenderer content={segment.text} className="text-sm break-words [overflow-wrap:anywhere]" />}
        </div>
    );
}

export default function CodeAgentMessage({ message, isStreaming }) {
    const [copied, setCopied] = useState(false);
    const textRef = React.useRef(null);
    const segments = buildSegments(message);
    const content = getPlanText(message);
    const error = message.error || (message.isError && !content ? '生成失败，请稍后重试。' : '');

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
            <div ref={textRef} className="flex w-full flex-col gap-1">
                <ThinkingLine message={message} isStreaming={isStreaming} />

                {segments.map(segment => (
                    <Segment key={segment.key} segment={segment} />
                ))}

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
