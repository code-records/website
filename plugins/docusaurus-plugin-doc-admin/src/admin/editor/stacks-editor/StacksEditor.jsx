import React, { createRef } from 'react';
import { createPortal } from 'react-dom';
import { message } from '../../utils/message';
import { uploadToCOS } from '../../utils/cos_utils';

// StacksEditor 样式
import "@stackoverflow/stacks-editor/dist/styles.css";
import "./stacks/stacks.css";  // 修改后的 stacks 样式（兼容 Docusaurus）
import "./StacksEditor.css";

// 图片上传配置
const IMAGE_UPLOAD_CONFIG = {
    maxSizeMB: 10,       // 限制大小 10MB
};

// 排序控件组件
const SortControl = ({ value, onChange }) => {
    const [position, setPosition] = React.useState('');

    React.useEffect(() => {
        setPosition(value !== undefined && value !== null ? String(value) : '');
    }, [value]);

    const handleChange = (e) => {
        const val = e.target.value;
        setPosition(val);
        onChange(val === '' ? null : Number(val));
    };

    return (
        <div className="toolbar-sort-control">
            <span className="codicon codicon-list-ordered" title="侧边栏排序位置 (sidebar_position)" />
            <input
                type="number"
                className="toolbar-sort-input"
                value={position}
                placeholder="0"
                min="0"
                onChange={handleChange}
            />
        </div>
    );
};

class StacksEditorComponent extends React.Component {
    constructor(props) {
        super(props);
        this.containerRef = createRef();
        this.editorInstance = null;
        this.lib = null;
        this.observer = null;
        this.scrollCleanup = null;

        this.state = {
            libLoaded: false,
            portalContainer: null
        };
    }

    componentDidMount() {
        this.init();
    }

    async init() {
        if (typeof window === 'undefined') return;

        try {
            // 动态导入编辑器库
            const module = await import("@stackoverflow/stacks-editor");

            // 注册中文本地化
            if (module.registerLocalizationStrings) {
                module.registerLocalizationStrings({
                    commands: {
                        bold: ({ shortcut }) => `加粗 ${shortcut}`,
                        emphasis: ({ shortcut }) => `斜体 ${shortcut}`,
                        link: ({ shortcut }) => `链接 ${shortcut}`,
                        blockquote: ({ shortcut }) => `引用 ${shortcut}`,
                        heading: "标题",
                        header: "标题",
                        code: ({ shortcut }) => `行内代码 ${shortcut}`,
                        inlinecode: ({ shortcut }) => `行内代码 ${shortcut}`,
                        inline_code: ({ shortcut }) => `行内代码 ${shortcut}`,
                        codeblock: "代码块",
                        code_block: "代码块",
                        image: ({ shortcut }) => `图片 ${shortcut}`,
                        ordered_list: ({ shortcut }) => `有序列表 ${shortcut}`,
                        unordered_list: ({ shortcut }) => `无序列表 ${shortcut}`,
                        table: "表格",
                        table_insert: "表格",
                        horizontal_rule: "分割线",
                        undo: "撤销",
                        redo: "重做",
                        strikethrough: "删除线",
                    },
                    image_upload: {
                        browse_button: "选择文件",
                        drag_and_drop: "拖放图片、粘贴图片",
                        supported_file_types: ({ types }) => `支持格式: ${types}`,
                        max_size: ({ size }) => `最大 ${size}`,
                        uploading: "上传中...",
                        upload_error: "上传失败",
                        upload_label: "选择文件",
                        drag_drop_label: ", 拖放",
                        or_paste_label: ", 或粘贴图片",
                        external_url_label: "输入链接",
                        supported_file_types_prefix: "支持格式: ",
                        max_size_suffix: ({ size }) => ` (最大 ${size})`,
                        add_button: "添加图片",
                        cancel_button: "取消",
                        upload_text: "上传",
                        browse: "浏览",
                    },
                });
            }

            this.lib = module.StacksEditor;
            this.setState({ libLoaded: true }, () => {
                this.createEditorInstance();
            });
        } catch (error) {
            console.error('[StacksEditor] Failed to load library:', error);
            message.error('编辑器加载失败');
        }
    }

    createEditorInstance() {
        if (!this.containerRef.current || !this.lib) return;

        const { value } = this.props;
        this.editorInstance = new this.lib(this.containerRef.current, value || "", {
            defaultView: 1, // 1 is Commonmark (Markdown mode)
            imageUpload: {
                handler: this.handleImageUpload
            }
        });

        // 注册 DOM 变动监听
        this.setupObserver();

        // 延迟注入自定义控件
        setTimeout(() => {
            this.setupPortalContainer();
            this.setupScrollShadow();
        }, 50);
    }

    handleImageUpload = async (file) => {
        if (file.size > IMAGE_UPLOAD_CONFIG.maxSizeMB * 1024 * 1024) {
            message.error(`图片太大啦！不能超过 ${IMAGE_UPLOAD_CONFIG.maxSizeMB}MB`);
            throw new Error("File too large");
        }

        try {
            const imageUrl = await uploadToCOS(file);
            return imageUrl;
        } catch (error) {
            message.error('图片上传失败: ' + (error.message || '未知错误'));
            throw error;
        }
    }

    setupObserver() {
        if (!this.containerRef.current) return;

        this.observer = new MutationObserver(() => {
            if (this.editorInstance && this.props.onChange) {
                const currentContent = this.editorInstance.content || '';
                if (currentContent !== this.props.value) {
                    this.props.onChange(currentContent);
                }
            }
        });

        this.observer.observe(this.containerRef.current, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    setupPortalContainer() {
        if (!this.containerRef.current) return;
        const toolbar = this.containerRef.current.querySelector('.js-editor-menu');
        if (!toolbar) return;

        const sortContainer = document.createElement('div');
        sortContainer.className = 'toolbar-sort-wrapper';
        toolbar.appendChild(sortContainer);
        this.setState({ portalContainer: sortContainer });
    }

    setupScrollShadow() {
        if (!this.containerRef.current) return;
        const scrollContainer = this.containerRef.current.querySelector('.s-textarea, .js-editor');
        const toolbar = this.containerRef.current.querySelector('.js-editor-menu');

        if (scrollContainer && toolbar) {
            const handleScroll = () => {
                if (scrollContainer.scrollTop > 0) {
                    toolbar.classList.add('is-stuck');
                } else {
                    toolbar.classList.remove('is-stuck');
                }
            };

            scrollContainer.addEventListener('scroll', handleScroll);
            this.scrollCleanup = () => {
                scrollContainer.removeEventListener('scroll', handleScroll);
            };
        }
    }

    componentDidUpdate(prevProps) {
        if (this.editorInstance && this.props.value !== prevProps.value) {
            if (this.props.value !== this.editorInstance.content) {
                if (this.observer) this.observer.disconnect();
                this.editorInstance.content = this.props.value;
                this.setupObserver();
            }
        }
    }

    componentWillUnmount() {
        if (this.observer) this.observer.disconnect();
        if (this.scrollCleanup) this.scrollCleanup();
        if (this.editorInstance && typeof this.editorInstance.destroy === 'function') {
            this.editorInstance.destroy();
        }
    }

    render() {
        const { libLoaded, portalContainer } = this.state;
        const { frontmatter, onFrontmatterChange } = this.props;

        return (
            <div
                ref={this.containerRef}
                className="stacks-editor-container"
            >
                {!libLoaded && <div style={{ padding: '20px', color: '#666' }}>正在准备编辑器...</div>}
                {portalContainer && createPortal(
                    <SortControl
                        value={frontmatter?.sidebar_position}
                        onChange={(val) => {
                            const newFrontmatter = { ...frontmatter };
                            if (val === null) {
                                delete newFrontmatter.sidebar_position;
                            } else {
                                newFrontmatter.sidebar_position = val;
                            }
                            onFrontmatterChange?.(newFrontmatter);
                        }}
                    />,
                    portalContainer
                )}
            </div>
        );
    }
}

export default StacksEditorComponent;
