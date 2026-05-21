import React from "react";
import StacksEditor from "./stacks-editor/StacksEditor";
import { parseFrontmatter, mergeFrontmatter } from "./frontmatter/utils";

/**
 * 编辑器组件 (Class Component 模式)
 * 采用全量 Markdown 编辑模式，Frontmatter 编辑通过工具栏控件注入
 */
export class Editor extends React.Component {
    constructor(props) {
        super(props);

        // 初始获取并储存原始值，作为“已同步”状态的基准
        const parsed = parseFrontmatter(props.markdown);
        this.base = {
            raw: props.markdown,            // 字节不差的原始全文
            content: parsed.content,        // 初始正文
            frontmatter: parsed.frontmatter // 初始元数据对象
        };
    }

    // 实时对比并通知父组件
    checkAndNotify = (newBody, newFM) => {
        const { onChange } = this.props;
        // 拼接成完整的 Markdown 字符串
        const newMarkdown = mergeFrontmatter(newFM, newBody);

        // 如果拼接后的结果等于原始快照，则传回 byte-perfect 原始串，保持状态纯净
        if (newMarkdown === this.base.raw) {
            onChange(this.base.raw);
        } else {
            onChange(newMarkdown);
        }
    }

    handleFrontmatterChange = (newFM) => {
        const { markdown } = this.props;
        const { content } = parseFrontmatter(markdown);
        this.checkAndNotify(content, newFM);
    }

    handleContentChange = (newBody) => {
        const { markdown } = this.props;
        const { frontmatter } = parseFrontmatter(markdown);
        this.checkAndNotify(newBody, frontmatter);
    }

    render() {
        const { markdown } = this.props;
        const { frontmatter, content } = parseFrontmatter(markdown);

        return (
            <div className="editor flex-1 flex flex-col h-full w-full overflow-hidden">
                <StacksEditor
                    value={content}
                    onChange={this.handleContentChange}
                    frontmatter={frontmatter}
                    onFrontmatterChange={this.handleFrontmatterChange}
                />
            </div>
        );
    }
}

export default Editor;
