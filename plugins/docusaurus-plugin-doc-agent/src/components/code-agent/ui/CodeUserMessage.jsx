import React from 'react';

export default function CodeUserMessage({ message }) {
    const content = typeof message.content === 'string' ? message.content : '';

    return (
        <div className="px-4 pt-4 pb-2 animate-[msg-fade-in_0.3s_ease-out]">
            <div className="bg-[var(--ifm-color-emphasis-100)] border border-[var(--ifm-color-emphasis-200)] p-3 rounded-xl">
                <div className="whitespace-pre-wrap text-sm leading-relaxed break-words text-[var(--ifm-font-color-base)]">
                    {content}
                </div>
            </div>
        </div>
    );
}
