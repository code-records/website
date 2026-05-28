/*
 * Code assistant 消息 UI 设计约定：
 * - 把运行时对象图按 [round, ...round.actions] 平铺成正文流。
 * - 每个可见片段只读取 item.text，不在这里从 tool 元数据里拼展示文案。
 * - 各 type 组件保持轻量；thinking/tool 只在同一套正文样式上加一个小标记。
 * - thinking 文本暂时最多显示 3 行，超出部分先隐藏，等后续设计展开交互。
 * - tool 详情暂时没有定稿，所以 tool 片段先保持纯文本，不做卡片或面板。
 */
import React from 'react';
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
    return buildSegments(message).map(item => item.text).join('\n\n');
}

function buildSegments(message) {
    return getRounds(message).flatMap((round, roundIndex) => {
        const actions = normalizeActions(round?.actions);

        return [round, ...actions]
            .map((item, itemIndex) => {
                const isRound = itemIndex === 0;
                const text = typeof item?.text === 'string' ? item.text.trim() : '';

                return {
                    key: isRound
                        ? `r-${roundIndex}`
                        : `a-${roundIndex}-${item.callId || item.label || item.type || itemIndex}`,
                    kind: isRound ? 'round' : 'action',
                    item,
                    text,
                    type: item?.type,
                };
            })
            .filter(item => item.text.length > 0);
    });
}

function SegmentLabel({ children }) {
    return (
        <span className="mb-1 inline-flex w-fit rounded border border-[var(--ifm-color-emphasis-200)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--ifm-color-emphasis-600)]">
            {children}
        </span>
    );
}

function BodySegment({ segment, className = 'text-[var(--ifm-font-color-base)]', label, maxLines }) {
    const contentStyle = maxLines
        ? {
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: maxLines,
            overflow: 'hidden',
        }
        : undefined;

    return (
        <div className={['min-w-0 max-w-full text-sm leading-relaxed break-words [overflow-wrap:anywhere]', className].join(' ')}>
            {label && <SegmentLabel>{label}</SegmentLabel>}
            <div style={contentStyle}>
                <MarkdownRenderer content={segment.text} className="text-sm break-words [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
            </div>
        </div>
    );
}

function ThinkingSegment({ segment }) {
    return <BodySegment segment={segment} label="思考" maxLines={3} />;
}

function ToolSegment({ segment }) {
    return <BodySegment segment={segment} label="工具" />;
}

function RoundSegment({ segment }) {
    return <BodySegment segment={segment} />;
}

function ErrorSegment({ segment }) {
    return <BodySegment segment={segment} className="text-red-600" />;
}

function MessageSegment({ segment }) {
    if (segment.type === 'thinking') return <ThinkingSegment segment={segment} />;
    if (segment.type === 'tool') return <ToolSegment segment={segment} />;
    if (segment.type === 'error') return <ErrorSegment segment={segment} />;
    return <RoundSegment segment={segment} />;
}

export default function CodeAssistantMessage({ message, isStreaming }) {
    const segments = buildSegments(message);
    const content = getPlanText(message);
    const error = message.error || (message.isError && !content ? '生成失败，请稍后重试。' : '');
    const hasContent = segments.length > 0 || !!error;

    return (
        <div className="px-4 py-2 animate-[msg-fade-in_0.3s_ease-out]">
            <div className="grid min-w-0 gap-2">
                {segments.map(segment => (
                    <MessageSegment key={segment.key} segment={segment} />
                ))}

                {!isStreaming && error && (
                    <BodySegment segment={{ text: error }} className="text-red-600" />
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
