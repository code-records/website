/*
 * Code assistant 消息 UI 说明：
 * - 从 plan/round 运行态数据构建时间线。
 * - 工具结果文本保留在 Action.text 上，默认不直接展示。
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

function buildTimelineItems(message) {
    const plan = getPrimaryPlan(message);
    const items = [];

    if (plan?.kind !== 'plan') return items;

    // 时间线只故意平铺到 plan/round 层级。
    // 只有 actions、没有正文的 round 会折叠进上一个 round，
    // 避免工具/状态更新产生很多空时间线节点。
    // action 继续嵌套在 round 下，等 UI 明确需要 action 级时间线时再平铺。
    items.push(plan);

    getRounds(plan).forEach(round => {
        if (round?.kind !== 'round') return;

        const actions = getVisibleActions(round.actions);
        const text = getText(round.text);

        if (text.length === 0) {
            const previous = getLastTimelineRound(items);
            if (actions.length > 0 && previous !== null) {
                previous.actions = previous.actions.concat(actions);
            }
            return;
        }

        items.push(createTimelineRound(round, actions));
    });

    console.log('items', items);
    return items;
}

function getPrimaryPlan(message) {
    return Array.isArray(message?.plans) ? message.plans[0] : null;
}

function getRounds(plan) {
    return Array.isArray(plan?.rounds) ? plan.rounds : [];
}

function getActions(round) {
    return Array.isArray(round?.actions) ? round.actions : [];
}

function getVisibleActions(actions) {
    return getActions({ actions })
        .filter(action => action?.kind === 'action')
        .filter(action => action.type !== 'thinking')
        .filter(action => action.type !== 'tool' || getActionLabel(action).length > 0)
        .filter(action => action.type === 'tool' || getText(action.text).length > 0);
}

function getText(text) {
    return typeof text === 'string' ? text.trim() : '';
}

function createTimelineRound(round, actions = getVisibleActions(round.actions)) {
    const timelineRound = {
        ...round,
        actions,
    };

    timelineRound.formatLabel = () => formatRoundLabelWithActions(round, timelineRound.actions);
    return timelineRound;
}

function getLastTimelineRound(items) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        if (items[index]?.kind === 'round') return items[index];
    }
    return null;
}

function getPlanText(items) {
    return items
        .filter(item => item?.kind === 'round')
        .map(round => getText(round.text))
        .filter(text => text.length > 0)
        .join('\n\n');
}

function formatPlanLabel(plan) {
    return plan.formatLabel();
}

function formatRoundLabel(round) {
    return round.formatLabel();
}

function formatRoundLabelWithActions(round, actions) {
    const label = round.formatLabel();
    const workStepCount = getWorkStepCount(label);

    if (workStepCount !== null || label.length === 0) {
        return `工作 ${actions.length} 步`;
    }

    return label;
}

function getWorkStepCount(label) {
    const match = /^工作\s+(\d+)\s+步$/.exec(label);
    return match ? Number(match[1]) : null;
}

function getActionLabel(action) {
    return action.label || action.call?.name || '';
}

function getTimelineItemKey(item, index) {
    if (item.kind === 'round') return `round:${index}:${item.count || ''}`;
    if (item.kind === 'plan') return `plan:${index}:${item.count || ''}`;
    return `item:${index}`;
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
    return <TypedText text={text} toneClass={ROUND_TEXT_CLASS} type="round.text" />;
}

function InlineActionSegment({ action }) {
    if (action.type === 'tool') {
        return (
            <LabelLine label={getActionLabel(action)} toneClass={ACTION_TEXT_CLASS} type={action.type} />
        );
    }

    if (action.type === 'error') {
        return (
            <TypedText text={getText(action.text)} toneClass="text-[var(--ifm-color-danger)]" type={action.type} />
        );
    }

    return <TypedText text={getText(action.text)} toneClass={ACTION_TEXT_CLASS} type={action.type} />;
}

function PlanLabel({ plan }) {
    return (
        <TimelineItem>
            <LabelLine label={formatPlanLabel(plan)} toneClass={PLAN_TEXT_CLASS} type="plan" />
        </TimelineItem>
    );
}

function RoundGroup({ round, running }) {
    const [expanded, setExpanded] = useState(false);
    const actions = getActions(round);
    const hasActions = actions.length > 0;

    return (
        <TimelineItem running={running}>
            <button
                type="button"
                className="mb-1 w-full cursor-pointer border-none bg-transparent p-0 text-left disabled:cursor-default"
                onClick={() => hasActions && setExpanded(value => !value)}
                disabled={!hasActions}
            >
                <LabelLine label={formatRoundLabel(round)} toneClass={ROUND_TEXT_CLASS} type="round.label">
                    {hasActions && (
                        <span className={['transition-transform', expanded ? 'rotate-90' : ''].join(' ')}>&gt;</span>
                    )}
                </LabelLine>
            </button>
            {expanded && hasActions && (
                <div className="mb-2 grid min-w-0 gap-2">
                    {actions.map((action, index) => (
                        <InlineActionSegment key={action.id || action.callId || index} action={action} />
                    ))}
                </div>
            )}
            <RoundText text={getText(round.text)} />
        </TimelineItem>
    );
}

function TimelineItemView({ item, running }) {
    if (item.kind === 'plan') return <PlanLabel plan={item} />;
    if (item.kind === 'round') return <RoundGroup round={item} running={running} />;
    return null;
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
    const items = buildTimelineItems(message);
    const content = getPlanText(items);
    const error = message.error || (message.isError && !content ? '生成失败，请稍后重试。' : '');
    const hasContent = items.length > 0 || !!error;

    return (
        <div className="px-4 py-2 animate-[msg-fade-in_0.3s_ease-out]">
            <div className="relative ml-2 grid min-w-0 gap-4 border-l border-[var(--ifm-color-emphasis-300)] pb-1">
                {items.map((item, index) => (
                    <TimelineItemView
                        key={getTimelineItemKey(item, index)}
                        item={item}
                        running={isStreaming && index === items.length - 1}
                    />
                ))}

                {!isStreaming && error && (
                    <ErrorSegment segment={{ text: error }} />
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
