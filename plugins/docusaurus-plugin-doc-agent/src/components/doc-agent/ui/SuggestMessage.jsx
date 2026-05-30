import React from 'react';

function parseSuggestItems(content) {
    const seen = new Set();
    return String(content || '')
        .split(/\r?\n|<br\s*\/?>/i)
        .map(line => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
        .filter(line => {
            if (!line) return false;
            if (seen.has(line)) return false;
            seen.add(line);
            return true;
        })
        .slice(0, 3);
}

export default function SuggestMessage({ message, onSelectSuggestion, floating = false }) {
    const suggestions = parseSuggestItems(message.flows?.[0]?.rounds?.[0]?.text);
    if (!suggestions.length) return null;

    return (
        <div className={`${floating ? 'px-4 pb-4 pt-2' : 'px-4 py-2'} animate-[msg-fade-in_0.3s_ease-out]`}>
            <div className={`${floating ? 'shadow-[0_10px_30px_rgba(0,0,0,0.10)]' : ''} rounded-lg border border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-background-color)] p-2`}>
                <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-medium text-[var(--ifm-color-emphasis-600)]">
                    <svg className="h-3.5 w-3.5 text-[var(--ifm-color-primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3v3" />
                        <path d="M12 18v3" />
                        <path d="m4.22 4.22 2.12 2.12" />
                        <path d="m17.66 17.66 2.12 2.12" />
                        <path d="M3 12h3" />
                        <path d="M18 12h3" />
                        <path d="m4.22 19.78 2.12-2.12" />
                        <path d="m17.66 6.34 2.12-2.12" />
                    </svg>
                    <span>推荐问题</span>
                </div>
                <div className="grid gap-1.5">
                    {suggestions.map((item, idx) => (
                        <button
                            key={`${item}-${idx}`}
                            type="button"
                            onClick={() => onSelectSuggestion?.(item)}
                            className="group flex w-full items-center justify-between gap-2 rounded-md border border-transparent bg-[var(--ifm-color-emphasis-100)] px-2.5 py-2 text-left text-xs leading-snug text-[var(--ifm-font-color-base)] cursor-pointer transition-colors hover:border-[var(--ifm-color-primary)] hover:bg-[var(--ifm-background-color)] hover:text-[var(--ifm-color-primary)]"
                            title={item}
                        >
                            <span className="min-w-0 flex-1 break-words">{item}</span>
                            <svg className="h-3.5 w-3.5 shrink-0 opacity-45 transition-transform group-hover:translate-x-0.5 group-hover:opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12h14" />
                                <path d="m13 6 6 6-6 6" />
                            </svg>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
