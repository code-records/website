import React, { useState, useEffect } from "react";
import { mdxCompiler } from "./core/mdxCompiler";
import MDXComponents from "./core/MDXComponents";
import MdxErrorBoundary from "./components/ErrorBoundary";
import CompileErrorDisplay from "./components/CompileErrorDisplay";
import "./preview.css";


let compileId = 0;

const Preview = ({ markdown }) => {
    const [state, setState] = useState({
        html: '',
        Content: null,
        error: null
    });

    useEffect(() => {
        const id = ++compileId;

        (async () => {
            try {
                const { html, Content, err } = await mdxCompiler(null, markdown, true);
                if (id !== compileId) return;
                setState({
                    html: html || '',
                    Content: Content || null,
                    error: err || null
                });
            } catch (e) {
                if (id !== compileId) return;
                setState({
                    error: { message: e.message || 'Compilation failed' },
                    Content: null,
                    html: ''
                });
            }
        })();
    }, [markdown]);

    const { Content, error, html } = state;

    return (
        <div className="flex flex-col h-full w-full">
            <div className="h-8 px-4 flex justify-between items-center bg-[#fcfcfc] border-b border-black/5 text-[11px] text-[#888] select-none">
                <div className="flex items-center gap-2 font-semibold">
                    <span className="w-1.5 h-1.5 bg-[var(--admin-primary-color)] rounded-full animate-preview-pulse" />
                    <span>实时预览</span>
                </div>
                <div>
                    {markdown.length} 字符
                </div>
            </div>
            <div className="w-full h-full overflow-auto bg-white">
                <div className="max-w-[820px] mx-auto px-10 py-10 min-h-full markdown-body">
                    <CompileErrorDisplay error={error} />

                    <MdxErrorBoundary key={markdown}>
                        {Content ? (
                            <Content components={MDXComponents} />
                        ) : (
                            <div dangerouslySetInnerHTML={{ __html: html }} />
                        )}
                    </MdxErrorBoundary>
                </div>
            </div>
        </div>
    );
};

export default Preview;
