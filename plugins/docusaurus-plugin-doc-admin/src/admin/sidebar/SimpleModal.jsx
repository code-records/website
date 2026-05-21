import React from 'react';

export class SimpleModal extends React.Component {
    render() {
        const { visible, title, children, onOk, onCancel, okText = '确定', cancelText = '取消', loading = false } = this.props;

        if (!visible) return null;

        return (
            <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-[3000]">
                <div className="bg-white rounded-lg w-[440px] max-w-[90vw] shadow-[0_6px_16px_rgba(0,0,0,0.1)] animate-modal-in">
                    <div className="px-5 py-4 border-b border-[#f0f0f0] flex justify-between items-center">
                        <div className="text-base font-semibold text-[#1a1a1a]">{title}</div>
                        <div className="cursor-pointer text-[#999] hover:text-[#333]" onClick={onCancel}>
                            <span className="codicon codicon-close" />
                        </div>
                    </div>
                    <div className="px-5 py-6">
                        {children}
                    </div>
                    <div className="px-5 py-3 border-t border-[#f0f0f0] flex justify-end gap-2">
                        <button className="px-4 py-1.5 rounded text-sm cursor-pointer border border-[#d9d9d9] bg-white text-[#595959] transition-all duration-200 hover:text-[var(--admin-primary-color)] hover:border-[var(--admin-primary-color)] disabled:opacity-60 disabled:cursor-not-allowed" onClick={onCancel} disabled={loading}>{cancelText}</button>
                        <button className="px-4 py-1.5 rounded text-sm cursor-pointer border border-[var(--admin-primary-color,#1890ff)] bg-[var(--admin-primary-color,#1890ff)] text-white transition-all duration-200 hover:bg-[#40a9ff] hover:border-[#40a9ff] disabled:opacity-60 disabled:cursor-not-allowed" onClick={onOk} disabled={loading}>
                            {loading ? '处理中...' : okText}
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
