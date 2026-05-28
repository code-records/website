/*
 * Code assistant 消息 UI 设计约定：
 * - 把运行时对象图按 [round, ...round.actions] 平铺成正文流。
 * - round/thinking/error 读取 item.text；tool 只展示 item.display。
 * - tool 展示文案由工具基类契约提供，UI 不从 tool input/result 推断文案。
 * - 各 type 组件保持轻量；thinking/tool 只在同一套正文样式上加一个小标记。
 * - thinking 文本暂时最多显示 3 行，超出部分先隐藏，等后续设计展开交互。
 * - tool result 仍保存在 Action.text 给 model 使用，默认不在 UI 展示。
 */
import React, { useState } from 'react';
import MarkdownRenderer from '../../doc-agent/ui/MarkdownRenderer.jsx';

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
            existing.display = action.display || existing.display;
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
    return buildSegments(message).map(item => item.text).join('\n\n');
}

function buildSegments(message) {
    return getRounds(message).flatMap((round, roundIndex) => {
        const actions = normalizeActions(round?.actions);

        return [round, ...actions]
            .map((item, itemIndex) => {
                const isRound = itemIndex === 0;
                const type = item?.type;
                const text = type === 'tool'
                    ? ''
                    : typeof item?.text === 'string' ? item.text.trim() : '';
                const hasToolDisplay = type === 'tool' && item?.display;

                return {
                    key: isRound
                        ? `r-${roundIndex}`
                        : `a-${roundIndex}-${item.callId || item.label || item.type || itemIndex}`,
                    kind: isRound ? 'round' : 'action',
                    item,
                    text,
                    type,
                    visible: text.length > 0 || hasToolDisplay,
                };
            })
            .filter(item => item.visible);
    });
}

function ThinkingSegment({ segment }) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div
            className="relative pl-3 border-l-2 border-[var(--ifm-color-emphasis-300)] cursor-pointer select-none"
            onClick={() => setExpanded(prev => !prev)}
        >
            <div className="flex items-center gap-1.5 mb-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--ifm-color-emphasis-500)] shrink-0">
                    <path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.5-3 5.7V17a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-2.3C6.3 13.5 5 11.5 5 9a7 7 0 0 1 7-7z" />
                    <line x1="9" y1="21" x2="15" y2="21" />
                    <line x1="10" y1="24" x2="14" y2="24" />
                </svg>
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--ifm-color-emphasis-500)]">
                    Thinking
                </span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`text-[var(--ifm-color-emphasis-400)] transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </div>
            <div
                className="text-xs leading-relaxed italic text-[var(--ifm-color-emphasis-600)] break-words [overflow-wrap:anywhere] transition-all duration-200"
                style={!expanded ? {
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 3,
                    overflow: 'hidden',
                } : undefined}
            >
                {segment.text}
            </div>
        </div>
    );
}

function ToolSegment({ segment }) {
    const display = segment.item?.display || {};
    const label = display.title || segment.item?.label || segment.item?.call?.name || 'tool';
    const subtitle = display.subtitle || display.detail || '';
    const statusText = display.statusText || (segment.item?.done ? '完成' : '执行中');
    const isDone = segment.item?.done;

    return (
        <div className="relative pl-3 border-l-2 border-[var(--ifm-color-primary)] bg-[var(--ifm-color-emphasis-100)] rounded-r-lg py-2 pr-3">
            <div className="flex items-center gap-2 min-w-0">
                {isDone ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-500 shrink-0">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                ) : (
                    <div className="w-3 h-3 rounded-full border-2 border-[var(--ifm-color-primary)] border-t-transparent animate-spin shrink-0" />
                )}
                <span className="inline-flex max-w-[45%] min-w-0 px-1.5 py-0.5 rounded bg-[var(--ifm-color-emphasis-200)] text-[10px] font-mono font-medium text-[var(--ifm-color-emphasis-700)] truncate">
                    {label}
                </span>
                {subtitle && (
                    <span className="text-[11px] text-[var(--ifm-color-emphasis-500)] font-mono truncate min-w-0 flex-1">
                        {subtitle}
                    </span>
                )}
                {statusText && (
                    <span className="text-[11px] text-[var(--ifm-color-emphasis-500)] shrink-0">
                        {statusText}
                    </span>
                )}
            </div>
        </div>
    );
}

function RoundSegment({ segment }) {
    return (
        <div className="min-w-0 max-w-full text-sm leading-relaxed break-words [overflow-wrap:anywhere]">
            <MarkdownRenderer content={segment.text} className="text-sm break-words [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
        </div>
    );
}

function ErrorSegment({ segment }) {
    return (
        <div className="relative pl-3 border-l-2 border-red-400 bg-[color-mix(in_srgb,var(--ifm-color-danger-lightest)_30%,transparent)] rounded-r-lg py-2 pr-3">
            <div className="flex items-start gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500 shrink-0 mt-0.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                <div className="min-w-0 text-sm text-[var(--ifm-color-danger)] break-words [overflow-wrap:anywhere]">
                    <MarkdownRenderer content={segment.text} className="text-sm break-words [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
                </div>
            </div>
        </div>
    );
}

function MessageSegment({ segment }) {
    if (segment.type === 'thinking') return <ThinkingSegment segment={segment} />;
    if (segment.type === 'tool') return <ToolSegment segment={segment} />;
    if (segment.type === 'error') return <ErrorSegment segment={segment} />;
    return <RoundSegment segment={segment} />;
}

function StreamingCursor() {
    return (
        <span className="inline-block w-2 h-4 bg-[var(--ifm-color-primary)] rounded-sm animate-pulse ml-0.5 align-middle" />
    );
}

export default function CodeAssistantMessage({ message, isStreaming }) {
    const segments = buildSegments(message);
    const content = getPlanText(message);
    const error = message.error || (message.isError && !content ? '生成失败，请稍后重试。' : '');
    const hasContent = segments.length > 0 || !!error;

    return (
        <div className="px-4 py-2 animate-[msg-fade-in_0.3s_ease-out]">
            <div className="grid min-w-0 gap-3">
                {segments.map((segment, index) => (
                    <React.Fragment key={segment.key}>
                        <MessageSegment segment={segment} />
                        {isStreaming && index === segments.length - 1 && segment.kind === 'round' && (
                            <StreamingCursor />
                        )}
                    </React.Fragment>
                ))}

                {!isStreaming && error && (
                    <ErrorSegment segment={{ text: error, item: {} }} />
                )}

                {!hasContent && !isStreaming && (
                    <div className="text-sm text-[var(--ifm-color-emphasis-600)]">
                        暂无可展示内容
                    </div>
                )}
            </div>
        </div>
    );
}
