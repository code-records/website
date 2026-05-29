/*
 * SmartScrollArea — 智能滚动置底容器
 *
 * 核心原理（滚动锁状态机）：
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  收到新消息/内容变更                                              │
 * │    ├─ 用户正在物理交互 (isUserInteracting) ?                      │
 * │    │   └─ YES → 锁死：不滚动，把控制权留给用户                     │
 * │    │   └─ NO  → 当前是否贴底 (shouldStickToBottom) ?              │
 * │    │             └─ NO  → 锁死：用户在看历史消息                   │
 * │    │             └─ YES → 执行置底                                │
 * │    └─ force=true (用户主动发送消息) → 无条件置底                    │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * 两个守卫状态：
 * 1. isUserInteracting（物理接触锁）
 *    - 触发：mousedown（鼠标按住滚动区）
 *    - 解除：mouseup / mouseleave
 *    - 作用：只要为 true，系统绝不强行改变滚动位置
 *
 * 2. shouldStickToBottom（贴底锁定）
 *    - 判定：scroll 事件中，距底部 < BUFFER(80px) 则为 true
 *    - 作用：为 false 说明用户在看历史，不自动拉底
 *
 * PC 端额外处理：
 * - wheel 事件也视为物理交互：激活交互锁 + debounce 150ms 后解除
 *   原因：wheel 不触发 mousedown，若不锁定，在缓冲区内的微小滚动
 *   会被 handleScroll 重置为贴底，下一帧流式更新就把视口拽回底部（抖动）
 *
 * 对外暴露：
 * - scrollToBottom(force?) — 父组件通过 ref 调用
 */
import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

const BUFFER = 80;

const SmartScrollArea = forwardRef(function SmartScrollArea({ className, children }, ref) {
    const containerRef = useRef(null);
    const isUserInteractingRef = useRef(false);
    const shouldStickToBottomRef = useRef(true);
    const wheelTimerRef = useRef(null);

    const scrollToBottom = useCallback((force = false) => {
        const el = containerRef.current;
        if (!el) return;

        if (!force && isUserInteractingRef.current) return;
        if (!force && !shouldStickToBottomRef.current) return;

        el.scrollTop = el.scrollHeight;
    }, []);

    useImperativeHandle(ref, () => ({ scrollToBottom, get innerText() { return containerRef.current?.innerText; } }), [scrollToBottom]);

    const handleScroll = useCallback(() => {
        if (isUserInteractingRef.current) return;
        const el = containerRef.current;
        if (!el) return;
        const { scrollTop, scrollHeight, clientHeight } = el;
        shouldStickToBottomRef.current = scrollHeight - scrollTop - clientHeight < BUFFER;
    }, []);

    const handleMouseDown = useCallback(() => {
        isUserInteractingRef.current = true;
    }, []);

    const handleMouseUp = useCallback(() => {
        isUserInteractingRef.current = false;
    }, []);

    // wheel 也是物理交互：激活交互锁，debounce 150ms 后解除，
    // 防止在缓冲区内的微小滚动被 handleScroll 重置贴底状态后又被拽回底部
    const handleWheel = useCallback((e) => {
        if (e.deltaY < 0) {
            shouldStickToBottomRef.current = false;
        }
        isUserInteractingRef.current = true;
        clearTimeout(wheelTimerRef.current);
        wheelTimerRef.current = setTimeout(() => {
            isUserInteractingRef.current = false;
        }, 150);
    }, []);

    return (
        <div
            ref={containerRef}
            className={className}
            onScroll={handleScroll}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
        >
            {children}
        </div>
    );
});

export default SmartScrollArea;
