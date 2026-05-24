import React, { useMemo } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true });

function ExternalLink(props) {
    return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

function renderMarkdown(content) {
    const tree = processor.runSync(processor.parse(content));
    return toJsxRuntime(tree, {
        Fragment,
        jsx,
        jsxs,
        components: {
            a: ExternalLink,
        },
    });
}

export default function MarkdownRenderer({ content, className = '' }) {
    const element = useMemo(() => {
        if (!content) return null;
        try {
            return renderMarkdown(content);
        } catch {
            return <span>{content}</span>;
        }
    }, [content]);

    return element ? <div className={`markdown ${className}`.trim()}>{element}</div> : null;
}
