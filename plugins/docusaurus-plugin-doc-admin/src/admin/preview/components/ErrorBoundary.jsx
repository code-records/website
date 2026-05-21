import React from "react";

// 错误边界组件，用于捕获 MDX 渲染时的运行时错误
export default class MdxErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidUpdate(prevProps) {
        // 如果内容变化，尝试重置错误状态
        if (prevProps.children !== this.props.children) {
            this.setState({ hasError: false, error: null });
        }
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    padding: '20px',
                    backgroundColor: '#fff1f0',
                    border: '1px solid #ffa39e',
                    borderRadius: '4px',
                    color: '#cf1322',
                    fontFamily: 'monospace',
                    marginTop: '20px' // 增加顶部间隙
                }}>
                    <h3 style={{ marginTop: 0 }}>Preview Render Error</h3>
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{this.state.error?.message}</pre>
                    <p style={{ fontSize: '12px', color: '#666', marginBottom: 0 }}>提示：请检查 MDX 中是否使用了未定义的组件或语法错误。</p>
                </div>
            );
        }
        return this.props.children;
    }
}
