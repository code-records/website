import React, { useEffect } from 'react';
import { A2uiSurface, MarkdownContext } from '@a2ui/react/v0_9';
import { renderMarkdown } from '@a2ui/markdown-it';

const STYLE_ID = 'docs-a2ui-runtime-style';
const FRAME_CSS = `
.docs-a2ui-frame {
  --a2ui-color-primary: var(--ifm-color-primary);
  --a2ui-color-primary-hover: color-mix(in srgb, var(--ifm-color-primary) 88%, black);
  --a2ui-color-background: transparent;
  --a2ui-color-on-background: var(--ifm-font-color-base);
  --a2ui-color-surface: var(--ifm-background-surface-color, var(--ifm-background-color));
  --a2ui-color-on-surface: var(--ifm-font-color-base);
  --a2ui-color-border: var(--ifm-color-emphasis-200);
  --a2ui-border-radius: 8px;
  --a2ui-font-size: 0.875rem;
  --a2ui-grid-base: 0.5rem;
  color: var(--ifm-font-color-base);
}
.docs-a2ui-frame button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  min-height: 2rem;
  max-width: 100%;
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--ifm-color-emphasis-300);
  border-radius: 8px;
  background: var(--ifm-background-surface-color, var(--ifm-background-color));
  color: var(--ifm-font-color-base);
  cursor: pointer;
  font: inherit;
  font-size: 0.8125rem;
  line-height: 1.2;
}
.docs-a2ui-frame button:hover {
  border-color: var(--ifm-color-primary);
  color: var(--ifm-color-primary);
}
.docs-a2ui-frame button p {
  margin: 0;
}
.docs-a2ui-frame button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.docs-a2ui-frame input,
.docs-a2ui-frame textarea,
.docs-a2ui-frame select {
  max-width: 100%;
  border: 1px solid var(--ifm-color-emphasis-300);
  border-radius: 8px;
  background: var(--ifm-background-color);
  color: var(--ifm-font-color-base);
}
.docs-a2ui-frame img,
.docs-a2ui-frame video {
  max-width: 100%;
}
`;

function useA2UIFrameStyles() {
    useEffect(() => {
        if (typeof document === 'undefined') {
            return;
        }
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = FRAME_CSS;
        document.head.appendChild(style);
    }, []);
}

function handleLinkClick(event) {
    const link = event.target?.closest?.('a[href]');
    if (!link) return;

    event.preventDefault();
    window.open(link.href, '_blank', 'noopener,noreferrer');
}

export function A2UISurface({ surface }) {
    useA2UIFrameStyles();
    if (!surface) return null;

    return (
        <div className="px-4 py-2 animate-[msg-fade-in_0.3s_ease-out]">
            <div
                className="docs-a2ui-frame w-full rounded-lg border border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-background-color)] p-3 overflow-hidden"
                onClick={handleLinkClick}
            >
                <MarkdownContext.Provider value={renderMarkdown}>
                    <A2uiSurface surface={surface} />
                </MarkdownContext.Provider>
            </div>
        </div>
    );
}

export default A2UISurface;
