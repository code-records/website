import React from 'react';

export default function CodeUserMessage({ message }) {
    const content = message.flows?.[0]?.result?.rounds?.[0]?.text || '';

    return (
        <div className="px-4 pt-4 pb-2 animate-[msg-fade-in_0.3s_ease-out]">
            <div className="min-w-0 max-w-full overflow-hidden bg-[var(--ifm-color-emphasis-100)] border border-[var(--ifm-color-emphasis-200)] p-3 rounded-xl">
                <div className="min-w-0 max-w-full whitespace-pre-wrap text-sm leading-relaxed break-words [overflow-wrap:anywhere] text-[var(--ifm-font-color-base)]">
                    {content}
                </div>
            </div>
        </div>
    );
}
