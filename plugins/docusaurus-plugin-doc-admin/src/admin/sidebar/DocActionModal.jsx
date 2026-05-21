import React from 'react';
import { SimpleModal } from './SimpleModal';
import { SidebarAggregator } from './SidebarAggregator';

/**
 * DocActionModal - 文件/文件夹操作专用弹窗
 * 封装了名称清理、后缀补全提示等业务逻辑
 */
export class DocActionModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            inputValue: ''
        };
    }

    componentDidUpdate(prevProps) {
        // 当弹窗打开时，初始化输入框
        if (!prevProps.visible && this.props.visible) {
            const cleanName = SidebarAggregator.getCleanName(this.props.initialValue, this.props.type);
            this.setState({ inputValue: cleanName });
        }
    }

    handleOk = () => {
        const { inputValue } = this.state;
        if (!inputValue || !inputValue.trim()) return;

        // 返回清理后的纯净名称（不带 .md）
        this.props.onOk(inputValue.trim());
    };

    render() {
        const { visible, type, action, loading, onCancel } = this.props;
        const isRename = action === 'rename';
        const typeLabel = type === 'folder' ? '文件夹' : '文件';
        const title = `${isRename ? '重命名' : '新建'}${typeLabel}`;

        return (
            <SimpleModal
                visible={visible}
                title={title}
                okText="确定"
                cancelText="取消"
                loading={loading}
                onOk={this.handleOk}
                onCancel={onCancel}
            >
                <div style={{ marginBottom: '8px', fontSize: '12px', color: '#666' }}>
                    请输入{typeLabel}名称:
                </div>
                <input
                    className="w-full px-3 py-2 border border-[#d9d9d9] rounded outline-none text-sm focus:border-[#1890ff] focus:shadow-[0_0_0_2px_rgba(24,144,255,0.2)]"
                    autoFocus
                    value={this.state.inputValue}
                    onChange={e => this.setState({ inputValue: e.target.value })}
                    onKeyDown={e => e.key === 'Enter' && this.handleOk()}
                    placeholder={`例如: ${type === 'folder' ? 'my_docs' : 'hello_world'}`}
                />
                {type === 'file' && (
                    <div style={{ marginTop: '8px', fontSize: '11px', color: '#999' }}>
                        * 系统将自动补全 .md 后缀
                    </div>
                )}
            </SimpleModal>
        );
    }
}
