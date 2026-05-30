/*
 * Code assistant message UI.
 * - Builds a timeline from flow/round runtime state.
 * - Tool result text stays on Step.text and is hidden by default.
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

        // Keep the timeline at flow/round level; steps stay nested under rounds.
        for (const round of flow.result?.rounds ?? []) {
            const steps = round.steps
                .filter(step => step.type !== 'thinking')
                .map(step => ({
                    kind: 'step',
                    id: step.id || step.callId || '',
                    label: step.label || step.call?.name || '',
                    text: typeof step.text === 'string' ? step.text.trim() : '',
                    type: step.type,
                    usage: step.usage,
                    call: step.call,
                }))
                .filter(step => step.type === 'tool' ? step.label.length > 0 : step.text.length > 0);

            const text = typeof round.text === 'string' ? round.text.trim() : '';
            if (text.length === 0) {
                const previous = items[items.length - 1];
                if (steps.length > 0 && previous?.kind === 'round') {
                    previous.steps = previous.steps.concat(steps);
                    previous.label = formatStepsUsageLabel(previous.steps, round.status) || formatRoundLabel(round);
                }
                continue;
            }

            const label = formatStepsUsageLabel(steps, round.status) || formatRoundLabel(round);
            items.push({
                kind: 'round',
                label,
                steps,
                text,
            });
        }
    }

    return items;
}

function formatRoundLabel(round) {
    return round.formatLabel();
}

function formatStepsUsageLabel(steps, status) {
    const groups = collectUsageGroups(steps);
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

function collectUsageGroups(steps) {
    const groups = new Map();
    for (const step of steps) {
        const usage = step.usage;
        if (step.type !== 'tool' || usage === undefined || !isCountableUsage(usage)) continue;

        const groupKey = `${usage.verb}\u0000${usage.name}\u0000${usage.unit}`;
        const group = groups.get(groupKey) || {
            count: 0,
            keyedCount: 0,
            keys: new Set(),
            name: usage.name,
            unit: usage.unit,
            verb: usage.verb,
        };

        if (typeof usage.key === 'string' && usage.key.length > 0 && !shouldCountUsagePerStep(step)) {
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

function shouldCountUsagePerStep(step) {
    if (step.type !== 'tool') return false;
    if (step.call?.name === 'file' && step.call?.input?.operation === 'list') return true;
    return typeof step.label === 'string' && step.label.startsWith('List files:');
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

function InlineStepSegment({ step }) {
    if (step.type === 'tool') {
        return (
            <span className={LABEL_TEXT_CLASS}>
                {withDebugTag(step.type, step.label)}
            </span>
        );
    }

    if (step.type === 'error') {
        return (
            <TypedText text={step.text} type={step.type} />
        );
    }

    return <TypedText text={step.text} type={step.type} />;
}

function RoundGroup({ item, running }) {
    const [expanded, setExpanded] = useState(false);
    const hasSteps = item.steps.length > 0;

    return (
        <TimelineItem running={running}>
            {hasSteps ? (
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
            {expanded && hasSteps && (
                <div className="mb-2 grid min-w-0 gap-2">
                    {item.steps.map((step, index) => (
                        <InlineStepSegment key={step.id || index} step={step} />
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
