/*
 * Code assistant message UI.
 * - Builds a timeline from flow/round runtime state.
 * - Tool result text stays on Action.text and is hidden by default.
 */
import React, { useState } from 'react';
import MarkdownRenderer from '../../doc-agent/ui/MarkdownRenderer.jsx';

const LABEL_TEXT_CLASS = 'inline-flex min-w-0 items-center gap-1.5 text-xs font-normal leading-relaxed break-words [overflow-wrap:anywhere]';
const DEBUG_TIMELINE_TAGS = true;

function buildTimelineItems(message) {
    const items = [];

    for (const flow of message.flows) {
        items.push({
            kind: 'flow',
            label: flow.formatLabel(),
        });

        // Keep the timeline at flow/round level; actions stay nested under rounds.
        for (const round of flow.rounds) {
            const actions = round.actions
                .filter(action => action.type !== 'thinking')
                .map(action => ({
                    kind: 'action',
                    id: action.id || action.callId || '',
                    label: action.label || action.call?.name || '',
                    text: typeof action.text === 'string' ? action.text.trim() : '',
                    type: action.type,
                    usage: action.usage,
                    call: action.call,
                }))
                .filter(action => action.type === 'tool' ? action.label.length > 0 : action.text.length > 0);

            const text = typeof round.text === 'string' ? round.text.trim() : '';
            if (text.length === 0) {
                const previous = items[items.length - 1];
                if (actions.length > 0 && previous?.kind === 'round') {
                    previous.actions = previous.actions.concat(actions);
                    previous.label = formatActionsUsageLabel(previous.actions, round.status) || formatRoundLabel(round);
                }
                continue;
            }

            const label = formatActionsUsageLabel(actions, round.status) || formatRoundLabel(round);
            items.push({
                actions,
                kind: 'round',
                label,
                text,
            });
        }
    }

    return items;
}

function formatRoundLabel(round) {
    return round.formatLabel();
}

function formatActionsUsageLabel(actions, status) {
    const groups = collectUsageGroups(actions);
    if (groups.length === 0) return '';

    const byVerb = new Map();
    for (const group of groups) {
        const verbGroups = byVerb.get(group.verb) || [];
        verbGroups.push(group);
        byVerb.set(group.verb, verbGroups);
    }

    return Array.from(byVerb.entries())
        .map(([verb, verbGroups]) => {
            const prefix = status === 'completed' ? `${verb}了` : `正在${verb} `;
            return `${prefix}${verbGroups.map(formatUsageGroup).join('、')}`;
        })
        .join('；');
}

function collectUsageGroups(actions) {
    const groups = new Map();
    for (const action of actions) {
        const usage = action.usage;
        if (action.type !== 'tool' || usage === undefined || !isCountableUsage(usage)) continue;

        const groupKey = `${usage.verb}\u0000${usage.name}\u0000${usage.unit}`;
        const group = groups.get(groupKey) || {
            count: 0,
            keyedCount: 0,
            keys: new Set(),
            name: usage.name,
            unit: usage.unit,
            verb: usage.verb,
        };

        if (typeof usage.key === 'string' && usage.key.length > 0 && !shouldCountUsagePerAction(action)) {
            group.keys.add(usage.key);
            group.keyedCount = group.keys.size;
        } else {
            group.count += normalizeUsageCount(usage.count);
        }

        groups.set(groupKey, group);
    }
    return Array.from(groups.values());
}

function formatUsageGroup(group) {
    const total = group.count + group.keyedCount;
    return total > 0 ? `${total} ${group.unit}${group.name}` : group.name;
}

function isCountableUsage(usage) {
    return usage.verb.length > 0 && usage.name.length > 0 && usage.unit.length > 0;
}

function normalizeUsageCount(count) {
    return typeof count === 'number' && Number.isFinite(count)
        ? Math.max(0, Math.floor(count))
        : 1;
}

function shouldCountUsagePerAction(action) {
    if (action.type !== 'tool') return false;
    if (action.call?.name === 'file' && action.call?.input?.operation === 'list') return true;
    return typeof action.label === 'string' && action.label.startsWith('List files:');
}

function getFlowText(items) {
    return items
        .filter(item => item.kind === 'round')
        .map(item => item.text)
        .filter(Boolean)
        .join('\n\n');
}

function getTimelineItemKey(item, index) {
    return `${item.kind}:${index}`;
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
            <span className={LABEL_TEXT_CLASS}>
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

function RoundGroup({ item, running }) {
    const [expanded, setExpanded] = useState(false);
    const hasActions = item.actions.length > 0;

    return (
        <TimelineItem running={running}>
            {hasActions ? (
                <button
                    type="button"
                    className={[LABEL_TEXT_CLASS, 'mb-1 w-full cursor-pointer border-none bg-transparent p-0 text-left [font-family:inherit]'].join(' ')}
                    onClick={() => setExpanded(value => !value)}
                >
                    {withDebugTag('round.label', item.label)}
                    <span className={['transition-transform', expanded ? 'rotate-90' : ''].join(' ')}>&gt;</span>
                </button>
            ) : (
                <span className={LABEL_TEXT_CLASS}>
                    {withDebugTag('round.label', item.label)}
                </span>
            )}
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
    const content = getFlowText(items);
    const error = message.error || (message.isError && !content ? '生成失败，请稍后重试。' : '');
    const hasContent = items.length > 0 || !!error;

    return (
        <div className="px-4 py-2 animate-[msg-fade-in_0.3s_ease-out]">
            <div className="relative ml-2 grid min-w-0 gap-4 border-l border-[var(--ifm-color-emphasis-300)] pb-1">
                {items.map((item, index) => (
                    item.kind === 'flow'
                        ? (
                            <TimelineItem key={getTimelineItemKey(item, index)}>
                                <span className={LABEL_TEXT_CLASS}>
                                    {withDebugTag('flow', item.label)}
                                </span>
                            </TimelineItem>
                        )
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
