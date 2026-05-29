/*
 * Code assistant 消息 UI 说明：
 * - 从 plan/round 运行态数据构建纯展示时间线。
 * - 工具结果文本保留在 Action.text 上，默认不直接展示。
 */
import React, { useState } from 'react';
import MarkdownRenderer from '../../doc-agent/ui/MarkdownRenderer.jsx';

const LABEL_LINE_CLASS = 'inline-flex min-w-0 items-center gap-1.5 text-xs leading-relaxed';
const DEBUG_TIMELINE_TAGS = true;

function buildTimelineItems(message) {
    const plan = message.plans[0];

    const items = [{
        kind: 'plan',
        label: plan.formatLabel(),
    }];

    // 时间线只平铺到 plan/round 层级。只有 actions、没有正文的 round
    // 会折叠进上一个 round，避免工具/状态更新产生很多空时间线节点。
    // action 继续嵌套在 round 下，等 UI 明确需要 action 级时间线时再平铺。
    for (const round of plan.rounds) {
        const actions = round.actions
            .filter(action => action.type !== 'thinking')
            .map(action => ({
                kind: 'action',
                id: action.id || action.callId || '',
                label: action.label || action.call?.name || '',
                text: typeof action.text === 'string' ? action.text.trim() : '',
                type: action.type,
            }))
            .filter(action => action.type === 'tool' ? action.label.length > 0 : action.text.length > 0);

        const text = typeof round.text === 'string' ? round.text.trim() : '';
        if (text.length === 0) {
            const previous = items[items.length - 1];
            if (actions.length > 0 && previous?.kind === 'round') {
                previous.actions = previous.actions.concat(actions);
                previous.label = formatRoundLabel(round, previous.actions);
            }
            continue;
        }

        items.push({
            actions,
            kind: 'round',
            label: formatRoundLabel(round, actions),
            text,
        });
    }

    return items;
}

function formatRoundLabel(round, actions) {
    const label = round.formatLabel();
    if (/^工作\s+\d+\s+步$/.test(label) || label.length === 0) {
        return `工作 ${actions.length} 步`;
    }
    return label;
}

function getPlanText(items) {
    return items
        .filter(item => item.kind === 'round')
        .map(item => item.text)
        .filter(Boolean)
        .join('\n\n');
}

function getTimelineItemKey(item, index) {
    return `${item.kind}:${index}:${item.label || ''}`;
}

function TypedText({ text, type }) {
    if (!text) return null;

    return (
        <MarkdownRenderer content={withDebugTag(type, text)} className="text-xs break-words [overflow-wrap:anywhere] [&_*]:text-xs [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
    );
}

function InlineActionSegment({ action }) {
    if (action.type === 'tool') {
        return (
            <span className={[LABEL_LINE_CLASS, 'font-normal break-words [overflow-wrap:anywhere]'].join(' ')}>
                {withDebugTag(action.type, action.label)}
            </span>
        );
    }

    if (action.type === 'error') {
        return (
            <TypedText text={action.text} type={action.type} />
        );
    }

    return <TypedText text={action.text} type={action.type} />;
}

function PlanLabel({ item }) {
    return (
        <TimelineItem>
            <span className={[LABEL_LINE_CLASS, 'font-normal break-words [overflow-wrap:anywhere]'].join(' ')}>
                {withDebugTag('plan', item.label)}
            </span>
        </TimelineItem>
    );
}

function RoundGroup({ item, running }) {
    const [expanded, setExpanded] = useState(false);
    const hasActions = item.actions.length > 0;

    return (
        <TimelineItem running={running}>
            <button
                type="button"
                className="mb-1 w-full cursor-pointer border-none bg-transparent p-0 text-left disabled:cursor-default"
                onClick={() => hasActions && setExpanded(value => !value)}
                disabled={!hasActions}
            >
                <span className={[LABEL_LINE_CLASS, 'font-normal break-words [overflow-wrap:anywhere]'].join(' ')}>
                    {withDebugTag('round.label', item.label)}
                    {hasActions && (
                        <span className={['transition-transform', expanded ? 'rotate-90' : ''].join(' ')}>&gt;</span>
                    )}
                </span>
            </button>
            {expanded && hasActions && (
                <div className="mb-2 grid min-w-0 gap-2">
                    {item.actions.map((action, index) => (
                        <InlineActionSegment key={action.id || index} action={action} />
                    ))}
                </div>
            )}
            <TypedText text={item.text} type="round.text" />
        </TimelineItem>
    );
}

function withDebugTag(type, text) {
    return DEBUG_TIMELINE_TAGS ? `[${type}] ${text}` : text;
}

function TimelineItem({ children, running = false, tone = 'default' }) {
    const dotClass = running
        ? 'bg-[var(--ifm-color-primary)] animate-pulse'
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

export default function CodeAssistantMessage({ message, isStreaming }) {
    const items = buildTimelineItems(message);
    const content = getPlanText(items);
    const error = message.error || (message.isError && !content ? '生成失败，请稍后重试。' : '');
    const hasContent = items.length > 0 || !!error;

    return (
        <div className="px-4 py-2 animate-[msg-fade-in_0.3s_ease-out]">
            <div className="relative ml-2 grid min-w-0 gap-4 border-l border-[var(--ifm-color-emphasis-300)] pb-1">
                {items.map((item, index) => (
                    item.kind === 'plan'
                        ? <PlanLabel key={getTimelineItemKey(item, index)} item={item} />
                        : (
                            <RoundGroup
                                key={getTimelineItemKey(item, index)}
                                item={item}
                                running={isStreaming && index === items.length - 1}
                            />
                        )
                ))}

                {!isStreaming && error && (
                    <TimelineItem tone="error">
                        <TypedText text={error} type="error" />
                    </TimelineItem>
                )}

                {!hasContent && !isStreaming && (
                    <div className="text-xs text-[var(--ifm-color-emphasis-600)]">
                        暂无可展示内容
                    </div>
                )}
            </div>
        </div>
    );
}
