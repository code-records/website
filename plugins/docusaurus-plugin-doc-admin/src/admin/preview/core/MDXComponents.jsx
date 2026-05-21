import React from 'react';

// 为编辑器预览提供的组件 Mock
// 因为 Docusaurus 的原生组件（如 Tabs）依赖复杂的运行时 Context
// 在静态渲染的预览中，我们提供一个简单的交互式呈现

const CodeEditorPlaceholder = ({ defaultValue, language, title }) => (
    <div style={{
        margin: '20px 0',
        border: '1px solid #444',
        borderRadius: '8px',
        overflow: 'hidden',
        background: '#1e1e1e',
        color: '#d4d4d4',
        fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    }}>
        <div style={{
            padding: '8px 16px',
            background: '#252526',
            borderBottom: '1px solid #333',
            fontSize: '11px',
            color: '#777',
            display: 'flex',
            justifyContent: 'space-between',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
        }}>
            <span>{title || 'CodeEditor'} Placeholder ({language || 'json'})</span>
            <span style={{ color: '#555' }}>[Admin Preview]</span>
        </div>
        <pre style={{
            margin: 0,
            padding: '16px',
            fontSize: '13px',
            lineHeight: '1.5',
            color: '#9cdcfe',
            whiteSpace: 'pre-wrap',
            background: 'transparent',
            border: 'none'
        }}>
            <code>{defaultValue || '// No content'}</code>
        </pre>
    </div>
);

const Tabs = ({ children }) => {
    const [activeTab, setActiveTab] = React.useState(0);
    const childrenArray = React.Children.toArray(children).filter(child => React.isValidElement(child));

    if (childrenArray.length === 0) return null;

    return (
        <div className="mdx-tabs" style={{
            margin: '20px 0',
            background: '#fff',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
            overflow: 'hidden'
        }}>
            <ul style={{
                display: 'flex',
                listStyle: 'none',
                padding: '0 12px',
                margin: 0,
                background: '#f9fafb',
                borderBottom: '1px solid #e5e7eb',
                gap: '4px'
            }}>
                {childrenArray.map((child, index) => (
                    <li
                        key={index}
                        onClick={() => setActiveTab(index)}
                        style={{
                            padding: '10px 16px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            color: activeTab === index ? '#25c281' : '#6b7280',
                            fontWeight: activeTab === index ? '600' : '400',
                            borderBottom: activeTab === index ? '2px solid #25c281' : '2px solid transparent',
                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                            marginBottom: '-1px'
                        }}
                    >
                        {child.props.label || child.props.value || `Tab ${index + 1}`}
                    </li>
                ))}
            </ul>
            <div style={{ padding: '20px', fontSize: '15px', lineHeight: '1.6' }}>
                {childrenArray[activeTab]}
            </div>
        </div>
    );
};

const TabItem = ({ children }) => (
    <div className="mdx-tab-item">
        {children}
    </div>
);

const Admonition = ({ children, type = 'note', title }) => {
    const configs = {
        note: { border: '#606770', bg: '#f5f6f7', icon: '📝', color: '#606770' },
        tip: { border: '#00a400', bg: '#e6f6e6', icon: '💡', color: '#00a400' },
        info: { border: '#54c7ec', bg: '#ebf9fe', icon: 'ℹ️', color: '#54c7ec' },
        warning: { border: '#ffba00', bg: '#fff8e6', icon: '⚠️', color: '#ffba00' },
        danger: { border: '#fa383e', bg: '#ffeeef', icon: '🔥', color: '#fa383e' }
    };
    const config = configs[type] || configs.note;

    return (
        <div className={`admonition admonition-${type}`} style={{
            padding: '16px',
            margin: '20px 0',
            borderRadius: '8px',
            borderLeft: `6px solid ${config.border}`,
            backgroundColor: config.bg,
            boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)'
        }}>
            <div style={{
                fontWeight: '700',
                marginBottom: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: config.color,
                textTransform: 'uppercase',
                fontSize: '13px',
                letterSpacing: '0.5px'
            }}>
                <span>{config.icon}</span>
                <span>{title || type}</span>
            </div>
            <div style={{ color: '#1c1e21', fontSize: '15px', lineHeight: '1.6' }}>{children}</div>
        </div>
    );
};

const CodeBlock = ({ children, className }) => (
    <div style={{ margin: '20px 0', borderRadius: '8px', overflow: 'hidden' }}>
        <pre className={className} style={{
            padding: '16px',
            margin: 0,
            backgroundColor: '#282c34',
            color: '#abb2bf',
            fontSize: '14px',
            lineHeight: '1.5',
            overflow: 'auto',
            fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
        }}>
            <code>{children}</code>
        </pre>
    </div>
);

const Details = ({ children, summary }) => (
    <details style={{
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '0 16px',
        margin: '20px 0',
        background: '#f9fafb'
    }}>
        <summary style={{
            fontWeight: '600',
            padding: '14px 0',
            cursor: 'pointer',
            outline: 'none',
            color: '#1c1e21',
            userSelect: 'none'
        }}>
            {summary || '点击展开内容'}
        </summary>
        <div style={{ padding: '0 0 16px 0', borderTop: '1px solid #e5e7eb', paddingTop: '16px' }}>
            {children}
        </div>
    </details>
);

export const MDXComponents = {
    Tabs,
    TabItem,
    Admonition,
    CodeBlock,
    Details,
    CodeEditor: CodeEditorPlaceholder,
    // 兼容首字母大写
    tabItem: TabItem,
    admonition: Admonition,
};

export default MDXComponents;
