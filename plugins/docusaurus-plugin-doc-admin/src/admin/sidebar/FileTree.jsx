import React from 'react';

export class FileTree extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            expandedKeys: new Set(props.initialExpandedKeys || []),
            dragOverKey: null,
            dropPosition: null,
            isDragging: false,
        };
        this.ghostRef = React.createRef();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.autoExpandKeys !== this.props.autoExpandKeys && this.props.autoExpandKeys) {
            this.setState(prevState => {
                const newExpanded = new Set(prevState.expandedKeys);
                this.props.autoExpandKeys.forEach(key => newExpanded.add(key));
                return { expandedKeys: newExpanded };
            });
        }
    }

    toggleExpand = (key, e) => {
        e.stopPropagation();
        this.setState(prevState => {
            const newExpanded = new Set(prevState.expandedKeys);
            if (newExpanded.has(key)) {
                newExpanded.delete(key);
            } else {
                newExpanded.add(key);
            }
            return { expandedKeys: newExpanded };
        });
    }

    handleDragStart = (e, node) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ key: node.key, isLeaf: node.isLeaf }));
        e.dataTransfer.effectAllowed = 'move';
        this.setState({ isDragging: true });

        if (this.ghostRef.current) {
            const ghost = this.ghostRef.current;
            const iconClass = node.isLeaf ? 'markdown' : 'folder';
            ghost.innerHTML = `
                <div class="node-icon w-5 flex items-center justify-center mr-1.5 shrink-0">
                    <span class="codicon codicon-${iconClass}"></span>
                </div>
                <div class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap flex items-center">${node.title}</div>
            `;
            e.dataTransfer.setDragImage(ghost, 15, 15);
        }

        if (this.props.onDragStart) {
            this.props.onDragStart(e, node);
        }
    }

    handleDragOver = (e, node) => {
        e.preventDefault();
        e.stopPropagation();

        e.dataTransfer.dropEffect = 'move';

        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = rect.height;

        let position;
        if (!node.isLeaf) {
            if (y < height * 0.3) position = 'top';
            else if (y > height * 0.7) position = 'bottom';
            else position = 'middle';
        } else {
            position = y < height * 0.5 ? 'top' : 'bottom';
        }

        if (this.state.dragOverKey !== node.key || this.state.dropPosition !== position) {
            this.setState({ dragOverKey: node.key, dropPosition: position });
        }
    }

    handleDragLeave = (e, node) => {
        this.setState(prevState => {
            if (prevState.dragOverKey === node.key) {
                return { dragOverKey: null, dropPosition: null };
            }
            return null;
        });
    }

    handleDrop = (e, node) => {
        e.preventDefault();
        e.stopPropagation();

        const dragDataStr = e.dataTransfer.getData('application/json');
        if (!dragDataStr) return;

        try {
            const dragData = JSON.parse(dragDataStr);
            const position = this.state.dropPosition;

            this.setState({ dragOverKey: null, dropPosition: null, isDragging: false });

            if (this.props.onDrop && dragData.key !== node.key) {
                this.props.onDrop(dragData.key, node.key, position);
            }
        } catch (err) {
            console.error('Drop error:', err);
        }
    }

    renderNode = (node, level = 0) => {
        const { expandedKeys, dragOverKey, dropPosition } = this.state;
        const { selectedKey, searchValue } = this.props;

        const isExpanded = expandedKeys.has(node.key);
        const isSelected = selectedKey === node.key;
        const isLeaf = node.isLeaf;

        const titleMatch = searchValue && node.title.toLowerCase().includes(searchValue.toLowerCase());

        const isDragOver = dragOverKey === node.key;
        const dropClassName = isDragOver ? `drop-${dropPosition}` : '';

        return (
            <div key={node.key}>
                <div
                    className={`tree-node h-8 flex items-center cursor-pointer relative transition-[background] duration-100 hover:bg-black/[0.04] ${isSelected ? 'selected bg-[var(--admin-primary-light,#e6f7ff)]' : ''} ${dropClassName} ${isLeaf ? 'is-leaf' : 'is-folder'}`}
                    data-node-key={node.key}
                    style={{ paddingLeft: `${level * 12 + 8}px` }}
                    onClick={(e) => !isLeaf ? this.toggleExpand(node.key, e) : this.props.onSelect(node)}
                    onContextMenu={(e) => this.props.onContextMenu(e, node)}
                    draggable
                    onDragStart={(e) => this.handleDragStart(e, node)}
                    onDragOver={(e) => this.handleDragOver(e, node)}
                    onDragEnter={(e) => this.handleDragOver(e, node)}
                    onDragLeave={(e) => this.handleDragLeave(e, node)}
                    onDrop={(e) => this.handleDrop(e, node)}
                >
                    <div className="w-5 h-full flex items-center justify-center text-[#616161] shrink-0 hover:text-[#1c1e21]" onClick={(e) => !isLeaf && this.toggleExpand(node.key, e)}>
                        {!isLeaf && (
                            <span className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`} />
                        )}
                    </div>
                    <div className="node-icon w-5 flex items-center justify-center mr-1.5 shrink-0">
                        <span className={`codicon codicon-${isLeaf ? 'markdown' : (isExpanded ? 'folder-opened' : 'folder')}`} />
                    </div>
                    <div className={`flex-1 overflow-hidden text-ellipsis whitespace-nowrap flex items-center ${isSelected ? 'text-[var(--admin-primary-color)] font-semibold' : ''} ${titleMatch ? 'bg-[#ffc069]' : ''}`}>
                        {node.title}
                        {node.isLink && <span className={`text-white text-[10px] px-1.5 rounded-[10px] ml-2 font-normal h-4 leading-[14px] shrink-0 ${isSelected ? 'bg-[#d35400]' : 'bg-[#e67e22]'}`}>目录页</span>}
                    </div>
                </div>
                {!isLeaf && isExpanded && node.children && (
                    <div>
                        {node.children.map(child => this.renderNode(child, level + 1))}
                    </div>
                )}
            </div>
        );
    }

    render() {
        const { treeData } = this.props;
        const { isDragging } = this.state;

        const handleContainerDragOver = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        };

        return (
            <div className={`select-none text-sm text-[#1c1e21] ${isDragging ? 'dragging-active' : ''}`}
                onDragOver={handleContainerDragOver}
                onDragEnter={handleContainerDragOver}
                onDragEnd={() => this.setState({ isDragging: false })}>
                {treeData.map(node => this.renderNode(node, 0))}
                <div ref={this.ghostRef} className="drag-ghost fixed -top-[1000px] -left-[1000px] bg-white/95 border border-[var(--admin-primary-color)] rounded px-3 py-1.5 flex items-center shadow-[0_4px_12px_rgba(0,0,0,0.15)] -z-[1] pointer-events-none text-[13px] whitespace-nowrap"></div>
            </div>
        );
    }
}
