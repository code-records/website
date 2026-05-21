import React from "react";

/**
 * MDX 编译错误展示组件
 * @param {Object} props
 * @param {Error|{message: string}} props.error 错误对象
 */
const CompileErrorDisplay = ({ error }) => {
    if (!error) return null;

    return (
        <div style={{
            padding: '20px',
            backgroundColor: '#fff7e6',
            border: '1px solid #ffd591',
            borderRadius: '4px',
            marginTop: '20px',
            color: '#d46b08',
            fontFamily: 'sans-serif'
        }}>
            <strong style={{ display: 'block', marginBottom: '8px' }}>
                Compile Warning/Error:
            </strong>
            <pre style={{
                fontSize: '12px',
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontFamily: 'monospace',
                lineHeight: '1.5'
            }}>
                {error.message}
            </pre>
        </div>
    );
};

export default CompileErrorDisplay;
