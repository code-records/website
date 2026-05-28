import React from 'react';

export default function CodeExplorer({
    directoryHandle,
    workspaceFiles,
    onRefresh,
    onConnectDirectory,
    onDisconnectDirectory,
}) {
    return (
        <div className="w-64 bg-[var(--ifm-color-emphasis-100)] border-r border-[var(--ifm-color-emphasis-200)] flex flex-col shrink-0">
            <div className="p-4 border-b border-[var(--ifm-color-emphasis-200)] flex items-center justify-between shrink-0">
                <span className="text-xs font-bold text-[var(--ifm-font-color-base)]">文件浏览</span>
                {directoryHandle && (
                    <button onClick={onRefresh} className="p-1 border-none bg-transparent text-[var(--ifm-color-emphasis-500)] hover:text-[var(--ifm-color-primary)] cursor-pointer flex items-center" title="刷新">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                        </svg>
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 thin-scrollbar">
                {directoryHandle ? (
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between px-2 py-1.5 rounded bg-emerald-500/10 mb-2 text-[11px]">
                            <span className="font-bold text-emerald-600 dark:text-emerald-400 truncate" title={directoryHandle.name}>{directoryHandle.name}</span>
                            <button onClick={onDisconnectDirectory} className="p-1 border-none bg-transparent text-[var(--ifm-color-emphasis-500)] hover:text-rose-500 cursor-pointer flex items-center" title="断开">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </button>
                        </div>
                        {workspaceFiles.length > 0 ? (
                            workspaceFiles.map((file, i) => (
                                <div key={i} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--ifm-color-emphasis-200)] text-xs text-[var(--ifm-color-emphasis-700)] cursor-default">
                                    <span>{file.kind === 'directory' ? '📁' : '📄'}</span>
                                    <span className="truncate">{file.name}</span>
                                </div>
                            ))
                        ) : (
                            <div className="text-[10px] text-[var(--ifm-color-emphasis-500)] text-center mt-4">目录为空</div>
                        )}
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center p-4 text-center">
                        <span className="text-[11px] text-[var(--ifm-color-emphasis-500)] mb-3">未授权工作区</span>
                        <button onClick={onConnectDirectory} className="px-3 py-1.5 rounded-lg bg-[var(--ifm-color-primary)] text-white text-[11px] font-bold border-none hover:opacity-90 cursor-pointer">
                            授权连接目录
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
