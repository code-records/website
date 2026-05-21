import React from 'react';

const statusColors = {
    'A': '#28a745',
    'M': '#e67e22',
    'D': '#d73a49',
    'R': '#0366d6',
    'S': '#6f42c1',
};

export class StagingArea extends React.Component {
    render() {
        const { vfsNodes, sidebarsDirty, isCommitting, onCommit, onItemClick } = this.props;

        const nodes = Object.values(vfsNodes || {});
        let changes = nodes.map(node => {
            const isFile = node.type === 'file';
            const isModified = node.current.content !== node.base.content;
            const isMoved = node.base.path !== node.path;
            const isAdded = !node.base.existsInGit && !node.current.isDeleted;
            const isDeleted = node.base.existsInGit && node.current.isDeleted;

            if (isFile) {
                if (isDeleted) return { type: 'D', path: node.base.path, key: node.base.path };
                if (isAdded) return { type: 'A', path: node.path, key: node.path };
                if (isMoved) return { type: 'R', path: `${node.base.path} -> ${node.path}`, key: node.path };
                if (isModified) return { type: 'M', path: node.path, key: node.path };
            }
            return null;
        }).filter(Boolean);

        if (sidebarsDirty) {
            changes.push({ type: 'S', path: '目录结构与排序', key: 'SIDEBAR_JSON' });
        }

        changes.sort((a, b) => a.path.localeCompare(b.path));

        const statusLabel = {
            'A': { icon: 'diff-added' },
            'M': { icon: 'diff-modified' },
            'D': { icon: 'diff-removed' },
            'R': { icon: 'diff-renamed' },
            'S': { icon: 'list-ordered' }
        };

        if (changes.length === 0) return null;

        return (
            <div className="border-t border-[#e1e4e8] bg-[#f6f8fa] max-h-[250px] flex flex-col">
                <div className="px-3 py-2 flex items-center justify-between bg-white border-b border-[#e1e4e8]">
                    <div className="flex items-center gap-1.5">
                        <span className="codicon codicon-git-compare" />
                        <span className="text-xs font-semibold text-[#444d56] uppercase tracking-[0.5px]">待提交更改</span>
                        <span className="bg-[#0366d6] text-white text-[10px] px-1.5 py-px rounded-[10px]">{changes.length}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button
                            className="bg-white text-[#444d56] border border-[#e1e4e8] rounded px-2.5 py-1 text-xs font-medium cursor-pointer transition-all duration-200 hover:bg-[#f6f8fa] hover:border-[#d1d5da] hover:text-[#d73a49] disabled:text-[#959da5] disabled:cursor-not-allowed"
                            disabled={isCommitting}
                            onClick={this.props.onDiscard}
                            title="丢弃所有本地更改"
                        >
                            丢弃
                        </button>
                        <button
                            className="bg-[#2ea44f] text-white border-none rounded px-3 py-1 text-xs font-semibold cursor-pointer hover:bg-[#2c974b] disabled:bg-[#94d3a2] disabled:cursor-not-allowed"
                            disabled={isCommitting}
                            onClick={onCommit}
                        >
                            {isCommitting ? '...' : '提交'}
                        </button>
                    </div>
                </div>
                <div className="overflow-y-auto flex-1">
                    {changes.map((c, i) => {
                        const style = statusLabel[c.type] || {};
                        const color = statusColors[c.type] || '#586069';
                        return (
                            <div
                                key={i}
                                className="flex items-center px-3 py-1.5 cursor-pointer text-xs transition-[background] duration-100 hover:bg-[#eceff2]"
                                onClick={() => onItemClick(c)}
                            >
                                <div className="w-5 flex items-center justify-center mr-1.5 shrink-0" style={{ color }}>
                                    <span className={`codicon codicon-${style.icon}`} />
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <span className="text-[#586069]" title={c.path}>{c.path}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }
}
