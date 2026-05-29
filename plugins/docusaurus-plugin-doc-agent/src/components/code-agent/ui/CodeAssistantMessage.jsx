/*
 * Code assistant message UI notes:
 * - Build a lightweight display model from plan/round/action runtime data.
 * - Tool result text stays on Action.text for model context and is hidden by default.
 */
import React, { useState } from 'react';
import MarkdownRenderer from '../../doc-agent/ui/MarkdownRenderer.jsx';

const PLAN_TEXT_CLASS = 'text-red-500';
const ROUND_TEXT_CLASS = 'text-green-600';
const ACTION_TEXT_CLASS = 'text-blue-500';
const LABEL_LINE_CLASS = 'inline-flex min-w-0 items-center gap-1.5 text-xs leading-relaxed';

const LABEL_TAG_CLASS = [
    'inline-flex shrink-0 items-center',
    'text-xs font-normal normal-case leading-relaxed',
].join(' ');

function getPrimaryPlan(message) {
    return Array.isArray(message?.plans) ? message.plans[0] : null;
}

function getPlanLabel(message) {
    const plan = getPrimaryPlan(message);
    return plan?.formatLabel?.() || '';
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
        .filter(item => item?.type !== 'thinking')
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
    const rounds = getRounds(message);
    const groups = [];

    rounds.forEach((round, roundIndex) => {
        const actions = buildActionSegments(round?.actions);
        const text = typeof round?.text === 'string' ? round.text.trim() : '';
        const visible = text.length > 0 || actions.length > 0 || round?.status || round?.done === false;

        if (!visible) return;

        if (text.length === 0 && actions.length === 1 && groups.length > 0) {
            const previous = groups[groups.length - 1];
            previous.actions = previous.actions.concat(actions.map((segment, actionIndex) => ({
                ...segment,
                key: `${roundIndex}:${segment.key || actionIndex}`,
            })));
            previous.mergedSingleActionCount += 1;
            return;
        }

        groups.push({
            actions,
            baseActionCount: actions.length,
            key: `r-${roundIndex}`,
            mergedSingleActionCount: 0,
            round,
            text,
            visible: true,
        });
    });

    return groups;
}

function formatRoundLabel(group) {
    const label = group.round?.formatLabel?.() || group.round?.label || '';
    const mergedCount = group.mergedSingleActionCount || 0;
    if (mergedCount === 0) return label;

    const baseCount = getWorkStepCount(label) ?? group.baseActionCount ?? 0;
    if (getWorkStepCount(label) !== null || label.length === 0) {
        return `工作 ${baseCount + mergedCount} 步`;
    }
    return label;
}

function getWorkStepCount(label) {
    const match = /^工作\s+(\d+)\s+步$/.exec(label);
    return match ? Number(match[1]) : null;
}

function TypedText({ text, toneClass, type }) {
    if (!text) return null;

    return (
        <div className="flex min-w-0 max-w-full items-start gap-1.5 text-xs leading-relaxed break-words [overflow-wrap:anywhere]">
            <TypeTag type={type} toneClass={toneClass} />
            <div className="min-w-0 flex-1">
                <MarkdownRenderer content={text} className="text-xs break-words [overflow-wrap:anywhere] [&_*]:text-xs [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
            </div>
        </div>
    );
}

function RoundText({ text }) {
    return <TypedText text={text} toneClass={ROUND_TEXT_CLASS} type="round" />;
}

function InlineThinkingSegment({ segment }) {
    const [expanded, setExpanded] = useState(false);
    const label = segment.item?.label || '思考';

    return (
        <div className="min-w-0">
            <button
                type="button"
                className="cursor-pointer border-none bg-transparent p-0 text-left"
                onClick={() => setExpanded(prev => !prev)}
            >
                <LabelLine label={label} toneClass={ACTION_TEXT_CLASS} type={segment.type}>
                    <span className={['transition-transform', expanded ? 'rotate-90' : ''].join(' ')}>&gt;</span>
                </LabelLine>
            </button>
            {expanded && (
                <TypedText text={segment.text} toneClass={ACTION_TEXT_CLASS} type={segment.type} />
            )}
        </div>
    );
}

function InlineActionSegment({ segment }) {
    if (segment.type === 'thinking') return <InlineThinkingSegment segment={segment} />;
    if (segment.type === 'tool') {
        const label = segment.item?.label || segment.item?.call?.name || '工具';

        return (
            <LabelLine label={label} toneClass={ACTION_TEXT_CLASS} type={segment.type} />
        );
    }
    if (segment.type === 'error') {
        return (
            <TypedText text={segment.text} toneClass="text-[var(--ifm-color-danger)]" type={segment.type} />
        );
    }

    return <TypedText text={segment.text} toneClass={ACTION_TEXT_CLASS} type={segment.type} />;
}

function RoundGroup({ group, isStreaming }) {
    const [expanded, setExpanded] = useState(false);
    const hasActions = group.actions.length > 0;
    const label = formatRoundLabel(group);

    const handleClick = () => {
        if (hasActions) {
            setExpanded(prev => !prev);
        }
    };

    return (
        <TimelineItem running={isStreaming}>
            <button
                type="button"
                className="mb-1 w-full cursor-pointer border-none bg-transparent p-0 text-left disabled:cursor-default"
                onClick={handleClick}
                disabled={!hasActions}
            >
                <LabelLine label={label} toneClass={ROUND_TEXT_CLASS} type="round">
                    {hasActions && (
                        <span className={['transition-transform', expanded ? 'rotate-90' : ''].join(' ')}>&gt;</span>
                    )}
                </LabelLine>
            </button>
            {expanded && hasActions && (
                <div className="mb-2 grid min-w-0 gap-2">
                    {group.actions.map(segment => (
                        <InlineActionSegment key={segment.key} segment={segment} />
                    ))}
                </div>
            )}
            <RoundText text={group.text} />
        </TimelineItem>
    );
}

function PlanLabel({ label }) {
    if (!label) return null;

    return (
        <TimelineItem>
            <LabelLine label={label} toneClass={PLAN_TEXT_CLASS} type="plan" />
        </TimelineItem>
    );
}

function LabelLine({ children, label, toneClass, type }) {
    return (
        <span className={[LABEL_LINE_CLASS, toneClass].join(' ')}>
            <TypeTag type={type} toneClass={toneClass} />
            <span className="min-w-0 font-normal break-words [overflow-wrap:anywhere]">
                {label}
            </span>
            {children}
        </span>
    );
}

function TypeTag({ type, toneClass }) {
    return (
        <span className={[LABEL_TAG_CLASS, toneClass].join(' ')}>
            [{type}]
        </span>
    );
}

function TimelineItem({ children, running = false, tone = 'default' }) {
    const dotClass = running
        ? 'bg-[var(--ifm-color-primary)] animate-pulse'
        : tone === 'tool'
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
            <TypedText text={segment.text} toneClass="text-[var(--ifm-color-danger)]" type="error" />
        </TimelineItem>
    );
}

export default function CodeAssistantMessage({ message, isStreaming }) {
    const groups = buildRoundGroups(message);
    const planLabel = getPlanLabel(message);
    const content = getPlanText(message);
    const error = message.error || (message.isError && !content ? '生成失败，请稍后重试。' : '');
    const hasContent = planLabel.length > 0 || groups.length > 0 || !!error;

    return (
        <div className="px-4 py-2 animate-[msg-fade-in_0.3s_ease-out]">
            <div className="relative ml-2 grid min-w-0 gap-4 border-l border-[var(--ifm-color-emphasis-300)] pb-1">
                <PlanLabel label={planLabel} />

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
                    <div className="text-xs text-[var(--ifm-color-emphasis-600)]">
                        暂无可展示内容
                    </div>
                )}
            </div>
        </div>
    );
}
