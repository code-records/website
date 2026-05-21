import React from 'react';
import { DiffEditor } from '@monaco-editor/react';

export class DiffModal extends React.Component {
    render() {
        const { visible, filePath, remoteContent, localContent, onUseLocal, onUseRemote } = this.props;

        return (
            <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[3000]" style={{ display: visible ? 'flex' : 'none' }}>
                <div className="bg-white rounded-lg w-[90vw] h-[80vh] flex flex-col shadow-[0_8px_24px_rgba(0,0,0,0.15)] animate-modal-in">
                    <div className="px-5 py-4 border-b border-[#f0f0f0] flex justify-between items-center">
                        <span className="text-[15px] font-semibold flex items-center gap-2">文件冲突：{filePath}</span>
                    </div>
                    <div className="flex-1 min-h-0">
                        {visible && (
                            <DiffEditor
                                original={remoteContent || ''}
                                modified={localContent || ''}
                                language="markdown"
                                options={{
                                    readOnly: true,
                                    renderSideBySide: false,
                                    minimap: { enabled: false },
                                    fontSize: 13,
                                    scrollBeyondLastLine: false,
                                    wordWrap: 'on',
                                }}
                            />
                        )}
                    </div>
                    <div className="px-5 py-3 border-t border-[#f0f0f0] flex justify-end gap-2">
                        <button className="px-4 py-1.5 rounded text-sm cursor-pointer border border-[#d9d9d9] bg-white text-[#595959] transition-all duration-200 hover:text-[var(--admin-primary-color)] hover:border-[var(--admin-primary-color)]" onClick={onUseRemote}>使用远程版本</button>
                        <button className="px-4 py-1.5 rounded text-sm cursor-pointer border border-[var(--admin-primary-color)] bg-[var(--admin-primary-color)] text-white transition-all duration-200 hover:bg-[var(--admin-primary-dark)]" onClick={onUseLocal}>保留我的草稿</button>
                    </div>
                </div>
            </div>
        );
    }
}
