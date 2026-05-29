/*
 * Code assistant 消息 UI 设计约定：
 * - 把运行时对象图按 [...round.actions, round] 平铺成正文流。
 * - round/thinking/error 读取 item.text；tool 展示 item.label。
 * - tool 展示文案由工具 formatLabel 契约提供，UI 不从 tool input/result 推断文案。
 * - 各 type 组件保持轻量；thinking/tool 只在同一条 timeline 上加一个小标记。
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
    return buildRoundGroups(message)
        .map(group => group.text)
        .filter(text => text.length > 0)
        .join('\n\n');
}

function buildActionSegments(actions) {
    return normalizeActions(actions)
        .map(item => {
            const type = item?.type;
            const text = type === 'tool'
                ? ''
                : typeof item?.text === 'string' ? item.text.trim() : '';
            const hasToolLabel = type === 'tool' && typeof item?.label === 'string' && item.label.length > 0;

            return {
                key: item?.id,
                kind: 'action',
                item,
                text,
                type,
                visible: text.length > 0 || hasToolLabel,
            };
        })
        .filter(item => item.visible);
}

function buildRoundGroups(message) {
    return getRounds(message).map((round, roundIndex) => {
        const actions = buildActionSegments(round?.actions);
        const text = typeof round?.text === 'string' ? round.text.trim() : '';

        return {
            actions,
            key: `r-${roundIndex}`,
            round,
            text,
            visible: text.length > 0 || actions.length > 0 || round?.status || round?.done === false,
        };
    })
        .filter(group => group.visible);
}

function formatRoundLabel(group) {
    return `工作 ${group.actions.length} 步`;
}

function RoundText({ text }) {
    if (!text) return null;

    return (
        <div className="min-w-0 max-w-full text-sm leading-relaxed break-words [overflow-wrap:anywhere]">
            <MarkdownRenderer content={text} className="text-sm break-words [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
        </div>
    );
}

function InlineThinkingSegment({ segment }) {
    const [expanded, setExpanded] = useState(false);
    const label = segment.item?.label || '思考';

    return (
        <div className="min-w-0">
            <button
                type="button"
                className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-left text-xs text-[var(--ifm-color-emphasis-600)]"
                onClick={() => setExpanded(prev => !prev)}
            >
                <span>{label}</span>
                <span className={['transition-transform', expanded ? 'rotate-90' : ''].join(' ')}>&gt;</span>
            </button>
            {expanded && (
                <div className="mt-1 text-xs leading-relaxed text-[var(--ifm-color-emphasis-600)] break-words [overflow-wrap:anywhere]">
                    {segment.text}
                </div>
            )}
        </div>
    );
}

function InlineActionSegment({ segment }) {
    if (segment.type === 'thinking') return <InlineThinkingSegment segment={segment} />;
    if (segment.type === 'tool') {
        const label = segment.item?.label || segment.item?.call?.name || '工具';

        return (
            <div className="min-w-0 text-sm leading-relaxed text-[var(--ifm-font-color-base)]">
                <span className="font-semibold">{label}</span>
            </div>
        );
    }
    if (segment.type === 'error') {
        return (
            <div className="min-w-0 text-sm text-[var(--ifm-color-danger)] break-words [overflow-wrap:anywhere]">
                <MarkdownRenderer content={segment.text} className="text-sm break-words [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
            </div>
        );
    }

    return <RoundText text={segment.text} />;
}

function RoundGroup({ group, isStreaming }) {
    const [expanded, setExpanded] = useState(false);
    const hasActions = group.actions.length > 0;

    const handleClick = () => {
        if (hasActions) {
            setExpanded(prev => !prev);
        }
    };

    return (
        <TimelineItem>
            <button
                type="button"
                className="mb-1 flex w-full cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-left text-xs text-[var(--ifm-color-emphasis-600)] disabled:cursor-default"
                onClick={handleClick}
                disabled={!hasActions}
            >
                <span>{formatRoundLabel(group)}</span>
                {hasActions && (
                    <span className={['transition-transform', expanded ? 'rotate-90' : ''].join(' ')}>&gt;</span>
                )}
            </button>
            {expanded && hasActions && (
                <div className="mb-2 grid min-w-0 gap-2">
                    {group.actions.map(segment => (
                        <InlineActionSegment key={segment.key} segment={segment} />
                    ))}
                </div>
            )}
            <RoundText text={group.text} />
            {isStreaming && <StreamingCursor />}
        </TimelineItem>
    );
}

function TimelineItem({ children, tone = 'default' }) {
    const dotClass = tone === 'tool'
        ? 'bg-emerald-400'
        : tone === 'error'
            ? 'bg-red-500'
            : 'bg-[var(--ifm-color-emphasis-700)]';

    return (
        <div className="relative min-w-0 pl-5">
            <span className={['absolute left-[-5px] top-[0.55rem] h-2 w-2 rounded-full ring-4 ring-[var(--ifm-background-color)]', dotClass].join(' ')} />
            {children}
        </div>
    );
}

function ErrorSegment({ segment }) {
    return (
        <TimelineItem tone="error">
            <div className="min-w-0 text-sm text-[var(--ifm-color-danger)] break-words [overflow-wrap:anywhere]">
                <MarkdownRenderer content={segment.text} className="text-sm break-words [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
            </div>
        </TimelineItem>
    );
}

function StreamingCursor() {
    return (
        <span className="ml-5 inline-block h-4 w-2 rounded-sm bg-[var(--ifm-color-primary)] align-middle animate-pulse" />
    );
}

export default function CodeAssistantMessage({ message, isStreaming }) {
    const groups = buildRoundGroups(message);
    const content = getPlanText(message);
    const error = message.error || (message.isError && !content ? '生成失败，请稍后重试。' : '');
    const hasContent = groups.length > 0 || !!error;

    return (
        <div className="px-4 py-2 animate-[msg-fade-in_0.3s_ease-out]">
            <div className="relative ml-2 grid min-w-0 gap-4 border-l border-[var(--ifm-color-emphasis-300)] pb-1">
                {groups.map((group, index) => (
                    <RoundGroup
                        key={group.key}
                        group={group}
                        isStreaming={isStreaming && index === groups.length - 1}
                    />
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
