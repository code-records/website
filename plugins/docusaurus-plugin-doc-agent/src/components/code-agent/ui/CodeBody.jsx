import React from 'react';

export default function CodeBody({ hasRealMessages, messagesAreaRef, welcomeMessage, children }) {
    return (
        <div className="flex-1 relative overflow-hidden">
            {!hasRealMessages && (
                <div className="absolute inset-0 flex items-center justify-center px-8 pointer-events-none z-[1]">
                    <div className="flex flex-col items-center gap-3 text-center max-w-md">
                        <div className="w-12 h-12 rounded-xl bg-[var(--ifm-color-primary-lightest)] border border-[var(--ifm-color-primary-light)] flex items-center justify-center text-[var(--ifm-color-primary)] animate-[bounce_2s_infinite]">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <polyline points="16 18 22 12 16 6" />
                                <polyline points="8 6 2 12 8 18" />
                            </svg>
                        </div>
                        <h3 className="text-sm font-bold text-[var(--ifm-font-color-base)] tracking-widest m-0 uppercase">CodeAgent Terminal</h3>
                        <p className="text-xs text-[var(--ifm-color-emphasis-600)] leading-relaxed m-0">{welcomeMessage}</p>
                    </div>
                </div>
            )}
            <div ref={messagesAreaRef} className="h-full overflow-y-auto p-6 flex flex-col gap-6 thin-scrollbar">
                {!hasRealMessages && <div className="flex-1" />}
                {children}
            </div>
        </div>
    );
}
