import React, { useCallback, useRef, useState } from 'react';

export default function CodeHeader({ onCopyDisplay, onCopyStructured, onClearHistory }) {
    const [copiedText, setCopiedText] = useState(false);
    const [copiedStructured, setCopiedStructured] = useState(false);
    const textTimerRef = useRef(null);
    const structuredTimerRef = useRef(null);

    const handleCopyText = useCallback(() => {
        onCopyDisplay?.();
        setCopiedText(true);
        clearTimeout(textTimerRef.current);
        textTimerRef.current = setTimeout(() => setCopiedText(false), 1500);
    }, [onCopyDisplay]);

    const handleCopyStructured = useCallback(() => {
        onCopyStructured?.();
        setCopiedStructured(true);
        clearTimeout(structuredTimerRef.current);
        structuredTimerRef.current = setTimeout(() => setCopiedStructured(false), 1500);
    }, [onCopyStructured]);

    return (
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-color-emphasis-100)] shrink-0">
            <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[var(--ifm-font-color-base)] tracking-wide">CodeAgent</span>
            </div>

            <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleCopyText}
                        className={`w-7 h-7 border-none rounded bg-transparent cursor-pointer flex items-center justify-center transition-all ${copiedText ? 'text-emerald-500' : 'text-[var(--ifm-color-emphasis-600)] hover:text-[var(--ifm-color-emphasis-900)] hover:bg-[var(--ifm-color-emphasis-200)]'}`}
                        title="复制对话文本"
                    >
                        {copiedText ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                        )}
                    </button>
                    <button
                        onClick={handleCopyStructured}
                        className={`w-7 h-7 border-none rounded bg-transparent cursor-pointer flex items-center justify-center transition-all ${copiedStructured ? 'text-emerald-500' : 'text-[var(--ifm-color-emphasis-600)] hover:text-[var(--ifm-color-emphasis-900)] hover:bg-[var(--ifm-color-emphasis-200)]'}`}
                        title="复制结构化消息"
                    >
                        {copiedStructured ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2" />
                                <path d="M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2" />
                            </svg>
                        )}
                    </button>
                    <button
                        onClick={onClearHistory}
                        className="w-7 h-7 border-none rounded bg-transparent text-[var(--ifm-color-emphasis-600)] hover:text-rose-500 hover:bg-rose-500/5 cursor-pointer flex items-center justify-center transition-all"
                        title="重置当前会话"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}
