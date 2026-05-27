import React from 'react';

function WorkspaceFileIcon({ kind }) {
    if (kind === 'directory') {
        return (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
        );
    }

    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38BDF8" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    );
}

export default function CodeExplorer({
    directoryHandle,
    workspaceFiles,
    onRefresh,
    onConnectDirectory,
    onDisconnectDirectory,
}) {
    return (
        <div className="w-72 bg-[var(--ifm-color-emphasis-100)] border-r border-[var(--ifm-color-emphasis-200)] flex flex-col shrink-0">
            <div className="p-4 border-b border-[var(--ifm-color-emphasis-200)] flex items-center justify-between shrink-0">
                <span className="text-xs font-bold tracking-widest text-[var(--ifm-color-primary)] flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--ifm-color-primary)] animate-pulse" />
                    WORKSPACE EXPLORER
                </span>
                {directoryHandle && (
                    <button
                        onClick={onRefresh}
                        className="p-1 border-none bg-transparent text-[var(--ifm-color-emphasis-500)] hover:text-[var(--ifm-color-primary)] cursor-pointer flex items-center transition-colors"
                        title="刷新目录"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                        </svg>
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 thin-scrollbar">
                {directoryHandle ? (
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 mb-2 shrink-0">
                            <div className="flex items-center gap-1.5 overflow-hidden">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 truncate" title={directoryHandle.name}>
                                    {directoryHandle.name}
                                </span>
                            </div>
                            <button
                                onClick={onDisconnectDirectory}
                                className="p-1 border-none bg-transparent text-[var(--ifm-color-emphasis-500)] hover:text-rose-500 cursor-pointer flex items-center transition-colors"
                                title="断开本地目录"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>

                        {workspaceFiles.length > 0 ? (
                            workspaceFiles.map((file, i) => (
                                <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--ifm-color-emphasis-200)] text-xs text-[var(--ifm-color-emphasis-700)] hover:text-[var(--ifm-font-color-base)] transition-all cursor-default">
                                    <WorkspaceFileIcon kind={file.kind} />
                                    <span className="truncate">{file.name}</span>
                                </div>
                            ))
                        ) : (
                            <div className="text-[10px] text-[var(--ifm-color-emphasis-500)] text-center mt-4">目录为空</div>
                        )}
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center p-4 text-center">
                        <div className="w-10 h-10 rounded-xl bg-[var(--ifm-color-primary-lightest)] flex items-center justify-center text-[var(--ifm-color-primary)] border border-[var(--ifm-color-primary-light)] mb-3 animate-[pulse_2s_infinite]">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            </svg>
                        </div>
                        <span className="text-[11px] font-bold text-[var(--ifm-color-emphasis-500)] leading-relaxed">
                            未授权工作区<br />AI 无法操纵本地代码
                        </span>
                        <button
                            onClick={onConnectDirectory}
                            className="mt-4 px-3 py-1.5 rounded-lg bg-[var(--ifm-color-primary)] text-white text-[11px] font-bold border-none hover:opacity-90 cursor-pointer shadow-lg flex items-center gap-1 transition-all"
                        >
                            📂 授权连接目录
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
