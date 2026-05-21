import React from "react";
import { oauth2Client } from "../oauth2";
import { message } from "../utils/message";
import { VfsManager } from "../utils/vfs_logic";

// Custom Components
import { FileTree } from "./FileTree";
import { ContextMenu } from "./ContextMenu";
import { SidebarAggregator } from "./SidebarAggregator";
import { StagingArea } from "./StagingArea";
import { DocActionModal } from "./DocActionModal";

export class Sidebar extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            treeData: [],
            // Search related
            searchValue: '',
            autoExpandKeys: [],
            // Tree selection
            selectedKey: null,
            // Modal state
            modalVisible: false,
            modalType: 'file',
            modalAction: 'create',
            modalPath: '',
            isCreating: false,
            // Context Menu state
            contextMenuVisible: false,
            contextMenuX: 0,
            contextMenuY: 0,
            contextMenuNode: null,
            isCommitting: false,
        };

        this.markSidebarsDirty = this.markSidebarsDirty.bind(this);
    }

    getDocSetConfig() {
        const { docSet, docSetConfig } = this.props;
        return docSetConfig || {
            label: docSet,
            path: docSet,
            sidebarPath: `${docSet}/_meta/sidebars.json`,
            sidebarKey: 'sidebar',
        };
    }

    getDocRoot() {
        return this.getDocSetConfig().path || this.props.docSet;
    }

    componentDidMount() {
        this.loadRootTree();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.docSet !== this.props.docSet || prevProps.docSetConfig !== this.props.docSetConfig) {
            this.loadRootTree();
        }

        // 打印暂存区日志
        if (prevProps.vfsNodes !== this.props.vfsNodes || prevProps.sidebarsDirty !== this.props.sidebarsDirty) {
            const { vfsNodes, sidebarsDirty } = this.props;
            const nodes = Object.values(vfsNodes || {});
            const changes = nodes.map(node => {
                const isFile = node.type === 'file';
                const isModified = node.current.content !== node.base.content;
                const isMoved = node.base.path !== node.path;
                const isAdded = !node.base.existsInGit && !node.current.isDeleted;
                const isDeleted = node.base.existsInGit && node.current.isDeleted;
                if (isFile) {
                    if (isDeleted) return { type: 'D', path: node.base.path };
                    if (isAdded) return { type: 'A', path: node.path };
                    if (isMoved) return { type: 'R', path: `${node.base.path} -> ${node.path}` };
                    if (isModified) return { type: 'M', path: node.path };
                }
                return null;
            }).filter(Boolean);
            if (sidebarsDirty) changes.push({ type: 'S', path: 'sidebars.json' });

            if (changes.length > 0) {
                console.log('%c[Staging Area Update]', 'color: #007acc; font-weight: bold;', changes);
            }
        }
    }



    onSearch = (e) => {
        const value = e.target.value;
        const { treeData } = this.state;
        const autoExpandKeys = [];

        const findKeys = (data) => {
            data.forEach(node => {
                if (node.title.toLowerCase().indexOf(value.toLowerCase()) > -1) {
                    const parts = node.key.split('/');
                    let currentPath = '';
                    parts.forEach((p, i) => {
                        if (i < parts.length - 1) {
                            currentPath = currentPath ? `${currentPath}/${p}` : p;
                            if (!autoExpandKeys.includes(currentPath)) autoExpandKeys.push(currentPath);
                        }
                    });
                }
                if (node.children) findKeys(node.children);
            });
        };

        if (value) findKeys(treeData);

        this.setState({
            searchValue: value,
            autoExpandKeys,
        });
    };

    loadRootTree = async () => {
        const { updateVfsNodes } = this.props;
        const docSetConfig = this.getDocSetConfig();
        const docRoot = docSetConfig.path;
        try {
            const sidebarPath = docSetConfig.sidebarPath;
            const { content: sidebarJson } = await oauth2Client.getFileByPath(sidebarPath);
            const sidebarItems = JSON.parse(sidebarJson);
            const sidebarKey = docSetConfig.sidebarKey;
            const items = sidebarItems[sidebarKey];

            const allItems = await oauth2Client.getTreeRecursive(docRoot);
            const gitTree = {};
            allItems.forEach(item => {
                if (item.type === 'file') gitTree[item.path] = item.sha;
            });

            const initCache = this.props.vfsNodes || {};
            // 修复新建文件但在未提交刷新后消失在 UI 树中的问题
            Object.keys(initCache).forEach(path => {
                const node = initCache[path];
                if (node.type === 'file' && !node.current.isDeleted && !node.base.existsInGit) {
                    gitTree[path] = null; // 赋予虚假 sha 以让 Aggregator 生效
                }
            });

            const vfs = new VfsManager();
            vfs.initialize(items || [], docRoot, gitTree);

            let finalNodesObj = {};
            if (updateVfsNodes) {
                const existingCache = this.props.vfsNodes || {};
                vfs.nodes.forEach((node, path) => {
                    if (existingCache[path]) {
                        const cachedSha = existingCache[path].base?.sha;
                        const freshSha = node.base?.sha;
                        const hasConflict = cachedSha && freshSha && cachedSha !== freshSha;
                        console.log('[VFS Blend]', path, { cachedSha, freshSha, hasConflict });

                        finalNodesObj[path] = {
                            ...node,
                            // 始终使用缓存的 base：
                            // - 冲突时：保留旧 SHA，供 handleFileSelect 对比
                            // - 无冲突时：保留已解决的 SHA 和已加载的 content，避免 base 被重置为空
                            base: existingCache[path].base,
                            current: { ...node.current, ...existingCache[path].current },
                            _conflict: hasConflict || undefined,
                        };
                    } else {
                        finalNodesObj[path] = node;
                    }
                });

                // Preserve completely new draft local files/folders
                Object.keys(existingCache).forEach(path => {
                    if (!finalNodesObj[path]) {
                        finalNodesObj[path] = existingCache[path];
                    }
                });

                updateVfsNodes(finalNodesObj);
            } else {
                vfs.nodes.forEach((node, path) => finalNodesObj[path] = node);
            }

            const treeData = SidebarAggregator.toTreeData(items, docRoot, gitTree, finalNodesObj);
            this.setState({ treeData });
        } catch (error) {
            console.error('加载侧边栏失败:', error);
        }
    }


    createTreeNodeData(title, key, isNotLeaf = true, sha = null) {
        return {
            title: title,
            key: key,
            sha: sha,
            isLeaf: !isNotLeaf,
        };
    }

    findNodeInTree = (list, key) => {
        for (const node of list) {
            if (node.key === key) return true;
            if (node.children && this.findNodeInTree(node.children, key)) return true;
        }
        return false;
    }

    removeNodeFromTree = (list, key) => {
        return list.filter(node => {
            if (node.key === key) return false;
            if (node.children) {
                node.children = this.removeNodeFromTree(node.children, key);
            }
            return true;
        });
    }

    renameNodeInTree = (list, oldKey, newKey, newTitle) => {
        return list.map(node => {
            if (node.key === oldKey) {
                return { ...node, key: newKey, title: newTitle };
            }
            if (node.children) {
                return {
                    ...node,
                    children: this.renameNodeInTree(node.children, oldKey, newKey, newTitle),
                };
            }
            return node;
        });
    }

    appendNodeToTree = (list, parentKey, newNode) => {
        const docRoot = this.getDocRoot();
        if (!parentKey || parentKey === docRoot) {
            if (list.some(n => n.key === newNode.key)) return list;
            return [...list, newNode];
        }
        return list.map(node => {
            if (node.key === parentKey) {
                const children = [...(node.children || []), newNode];
                return { ...node, children, isLeaf: false };
            }
            if (node.children) {
                return {
                    ...node,
                    children: this.appendNodeToTree(node.children, parentKey, newNode),
                };
            }
            return node;
        });
    }

    onSelect = async (node) => {
        const { onFileSelect, vfsNodes } = this.props;

        if (node.isLeaf) {
            this.setState({ selectedKey: node.key });
            if (onFileSelect) {
                try {
                    const vfsNode = vfsNodes[node.key];
                    let content = vfsNode ? vfsNode.current.content : '';
                    let sha = node.sha || (vfsNode ? vfsNode.base.sha : null);
                    let passContent = content;

                    if (vfsNode && vfsNode._conflict && node.sha) {
                        // 冲突节点：用 fresh SHA 加载远程最新内容
                        const res = await oauth2Client.getFileContent(node.sha);
                        passContent = res.content;
                    } else if (vfsNode && vfsNode.base.content === null && vfsNode.base.existsInGit && sha) {
                        // base 尚未加载，从 Git 拉取原始内容
                        const res = await oauth2Client.getFileContent(sha);
                        passContent = res.content;
                    } else if (!vfsNode && sha) {
                        const res = await oauth2Client.getFileContent(sha);
                        passContent = res.content;
                    } else if (!vfsNode) {
                        const fileInfo = await oauth2Client.getFileByPath(node.key);
                        const res = await oauth2Client.getFileContent(fileInfo.blob_id || fileInfo.sha);
                        passContent = res.content;
                        sha = fileInfo.sha;
                    }

                    onFileSelect(node.key, sha, passContent);
                } catch (e) {
                    console.error('文件加载失败:', e);
                    message.error('文件加载失败，请重试');
                }
            }
        }
    }

    handleContextMenu = (e, node) => {
        e.preventDefault();
        this.setState({
            contextMenuVisible: true,
            contextMenuX: e.clientX,
            contextMenuY: e.clientY,
            contextMenuNode: node
        });
    }

    handleContextMenuAction = (key) => {
        const node = this.state.contextMenuNode;
        const path = node.key;
        if (key === 'add_file') {
            this.setState({ modalVisible: true, modalType: 'file', modalPath: path, modalAction: 'create' });
        } else if (key === 'add_folder') {
            this.setState({ modalVisible: true, modalType: 'folder', modalPath: path, modalAction: 'create' });
        } else if (key === 'rename') {
            this.setState({
                modalVisible: true,
                modalType: node.isLeaf ? 'file' : 'folder',
                modalPath: path,
                modalAction: 'rename'
            });
        } else if (key === 'delete') {
            this.showDeleteConfirm(node);
        } else if (key === 'assign_readme') {
            this.handleAssignReadme(node);
        } else if (key === 'unassign_readme') {
            this.handleUnassignReadme(node);
        }
    }
    handleAssignReadme = async (node) => {
        if (node.isLeaf) return;

        const { vfsNodes, updateVfsNodes } = this.props;
        const docRoot = this.getDocRoot();
        const folderPath = node.key;
        const readmePath = `${folderPath}/README.md`;
        const readmeId = readmePath.replace(`${docRoot}/`, '').replace('.md', '');

        // 1. 确保 VFS 中由于 README（处理新增或恢复被删除的情况）
        let newVfsNodes = { ...vfsNodes };
        const existsInVfs = !!newVfsNodes[readmePath];
        const isDeletedInVfs = existsInVfs && newVfsNodes[readmePath].current.isDeleted;

        if (!existsInVfs || isDeletedInVfs) {
            newVfsNodes[readmePath] = {
                path: readmePath,
                type: 'file',
                title: 'README',
                base: existsInVfs ? newVfsNodes[readmePath].base : { path: null, sha: null, content: '', existsInGit: false },
                current: { content: `# ${node.title}\n\n这是目录的主页。`, isDeleted: false }
            };
            updateVfsNodes(newVfsNodes);
        }

        // 2. 确保树中存在 README 节点（如果不存在则追加）
        let currentTree = this.state.treeData;
        const readmeExistsInTree = this.findNodeInTree(currentTree, readmePath);
        if (!readmeExistsInTree) {
            const readmeNode = this.createTreeNodeData('README', readmePath, false, null);
            currentTree = this.appendNodeToTree(currentTree, folderPath, readmeNode);
        }

        // 3. 统一更新 TreeData：使用聚合器方法设置 link 关联
        const updatedTree = SidebarAggregator.assignReadme(currentTree, folderPath, readmePath, readmeId);

        this.setState({ treeData: updatedTree }, () => {
            this.markSidebarsDirty();
            console.log(`[Success] README created/restored and linked for ${folderPath}`);
        });
    }

    handleUnassignReadme = (node) => {
        if (node.isLeaf) return;

        const docRoot = this.getDocRoot();
        const folderPath = node.key;
        const readmeId = `${folderPath}/README`.replace(`${docRoot}/`, '');

        // 只清除 link 关联，不删除 README 文件
        const updatedTree = SidebarAggregator.assignReadme(this.state.treeData, folderPath, null, readmeId, true);
        this.setState({ treeData: updatedTree }, () => {
            this.markSidebarsDirty();
            console.log(`[Success] Unlinked README for ${folderPath}`);
        });
    }

    showDeleteConfirm = (node) => {
        const isFolder = !node.isLeaf;
        if (!window.confirm(`确认删除${isFolder ? '文件夹' : '文件'} ${node.key} 吗？此操作不可逆。`)) return;

        const { currentPath, onFileDeleted, vfsNodes, updateVfsNodes } = this.props;
        const isDeletingCurrentFile = currentPath === node.key || (isFolder && currentPath.startsWith(node.key + '/'));

        const newVfsNodes = { ...vfsNodes };
        if (isFolder) {
            Object.keys(newVfsNodes).forEach(path => {
                if (path === node.key || path.startsWith(node.key + '/')) {
                    if (!newVfsNodes[path].base.existsInGit) {
                        delete newVfsNodes[path];
                    } else {
                        newVfsNodes[path] = { ...newVfsNodes[path], current: { ...newVfsNodes[path].current, isDeleted: true } };
                    }
                }
            });
        } else {
            if (newVfsNodes[node.key]) {
                if (!newVfsNodes[node.key].base.existsInGit) {
                    delete newVfsNodes[node.key];
                } else {
                    newVfsNodes[node.key] = { ...newVfsNodes[node.key], current: { ...newVfsNodes[node.key].current, isDeleted: true } };
                }
            }
        }

        updateVfsNodes(newVfsNodes);

        // 如果删除的是 README.md，则先清理其父目录的 Link 关联，再从树中移除节点
        let currentTree = this.state.treeData;
        if (!isFolder && node.key.toLowerCase().endsWith('/readme.md')) {
            const docRoot = this.getDocRoot();
            const parentKey = node.key.split('/').slice(0, -1).join('/');
            const readmeId = node.key.replace(`${docRoot}/`, '').replace('.md', '');
            currentTree = SidebarAggregator.assignReadme(currentTree, parentKey, null, readmeId, true);
        }

        currentTree = this.removeNodeFromTree(currentTree, node.key);
        this.setState({ treeData: currentTree });
        this.markSidebarsDirty();
        if (isDeletingCurrentFile && onFileDeleted) onFileDeleted();

    }

    handleModalOk = async (name) => {
        const { modalType, modalPath, modalAction } = this.state;
        const { currentPath, onFileCreated, onFileRenamed, vfsNodes, updateVfsNodes, onItemMoved } = this.props;
        const docRoot = this.getDocRoot();

        this.setState({ isCreating: true });
        try {
            if (modalAction === 'rename') {
                const oldPath = modalPath;
                const newPath = SidebarAggregator.getNodePath(name, modalType, oldPath.split('/').slice(0, -1).join('/'), docRoot);
                const newTitle = name;

                let updatedTree = this.renameNodeInTree(this.state.treeData, oldPath, newPath, newTitle);
                if (modalType === 'folder') {
                    // 递归更新子节点的 key（与 onDrop 逻辑保持一致）
                    const updateChildKeys = (children, op, np) => {
                        children.forEach(c => {
                            if (c.key.startsWith(op + '/')) c.key = np + c.key.substring(op.length);
                            if (c.children) updateChildKeys(c.children, op, np);
                        });
                    };
                    const updateInTree = (nodes) => {
                        nodes.forEach(node => {
                            if (node.key === newPath && node.children) {
                                updateChildKeys(node.children, oldPath, newPath);
                            } else if (node.children) {
                                updateInTree(node.children);
                            }
                        });
                    };
                    updatedTree = this.deepCloneTree(updatedTree);
                    updateInTree(updatedTree);

                    const oldDocPrefix = oldPath.replace(`${docRoot}/`, '');
                    const newDocPrefix = newPath.replace(`${docRoot}/`, '');
                    updatedTree = SidebarAggregator.fixLinkIds(updatedTree, oldDocPrefix, newDocPrefix);
                }

                if (onItemMoved) onItemMoved(oldPath, newPath, modalType);

                this.setState({ modalVisible: false, treeData: updatedTree });
                this.markSidebarsDirty();
                if (onFileRenamed && currentPath === oldPath) onFileRenamed(newPath);

            } else {
                const isFolder = modalType === 'folder';
                const treeKey = SidebarAggregator.getNodePath(name, modalType, modalPath, docRoot);
                const vfsPath = isFolder ? SidebarAggregator.getFolderGitKeepPath(treeKey) : treeKey;
                const initialContent = !isFolder ? '# ' + name : '';

                const newVfsNodes = { ...vfsNodes };
                newVfsNodes[vfsPath] = {
                    path: vfsPath,
                    type: modalType,
                    title: name,
                    base: { path: null, sha: null, content: '', existsInGit: false },
                    current: { content: initialContent, isDeleted: false }
                };
                updateVfsNodes(newVfsNodes);

                const newNode = this.createTreeNodeData(name, treeKey, isFolder, null);
                this.setState({
                    modalVisible: false,
                    treeData: this.appendNodeToTree(this.state.treeData, modalPath, newNode)
                });
                this.markSidebarsDirty();

                if (!isFolder && onFileCreated) {
                    onFileCreated(newNode.key, name, initialContent);
                    this.setState({ selectedKey: newNode.key });
                }
            }
        } catch (e) {
            console.error('Operation failed:', e);
        } finally {
            this.setState({ isCreating: false });
        }
    }

    deepCloneTree = (arr) => {
        if (!arr) return undefined;
        return arr.map(item => ({
            ...item,
            children: item.children ? this.deepCloneTree(item.children) : undefined
        }));
    }

    loopTree = (data, key, callback) => {
        for (let i = 0; i < data.length; i++) {
            if (data[i].key === key) {
                callback(data[i], i, data);
                return true;
            }
            if (data[i].children) {
                if (this.loopTree(data[i].children, key, callback)) {
                    return true;
                }
            }
        }
        return false;
    }

    onDrop = (dragKey, dropTargetKey, dropZone) => {
        const { treeData } = this.state;
        const data = this.deepCloneTree(treeData);
        let dropNodeIsFolder = false;
        this.loopTree(data, dropTargetKey, (item) => { dropNodeIsFolder = !item.isLeaf; });

        let dragObj = null;
        this.loopTree(data, dragKey, (item, index, arr) => {
            arr.splice(index, 1);
            dragObj = item;
        });

        if (!dragObj) return;

        let inserted = false;
        let newParentPath = null;

        if (dropZone === 'middle' && dropNodeIsFolder) {
            newParentPath = dropTargetKey;
            inserted = this.loopTree(data, dropTargetKey, (item) => {
                item.children = item.children || [];
                item.children.unshift(dragObj);
            });
        } else if (dropZone === 'top') {
            const targetParts = dropTargetKey.split('/');
            targetParts.pop();
            newParentPath = targetParts.join('/') || null;
            inserted = this.loopTree(data, dropTargetKey, (item, index, arr) => {
                arr.splice(index, 0, dragObj);
            });
        } else {
            const targetParts = dropTargetKey.split('/');
            targetParts.pop();
            newParentPath = targetParts.join('/') || null;
            inserted = this.loopTree(data, dropTargetKey, (item, index, arr) => {
                arr.splice(index + 1, 0, dragObj);
            });
        }

        if (inserted) {
            const originalParts = dragKey.split('/');
            const fileName = originalParts.pop();
            const { onItemMoved } = this.props;
            const docRoot = this.getDocRoot();
            const effectiveParentPath = newParentPath || docRoot;
            const newKey = `${effectiveParentPath}/${fileName}`;
            const oldKey = dragObj.key;

            if (oldKey !== newKey) {
                dragObj.key = newKey;
                if (!dragObj.isLeaf && dragObj.children) {
                    const updateKeys = (children, op, np) => {
                        children.forEach(c => {
                            if (c.key.startsWith(op + '/')) c.key = np + c.key.substring(op.length);
                            if (c.children) updateKeys(c.children, op, np);
                        });
                    };
                    updateKeys(dragObj.children, oldKey, newKey);
                }

                let finalData = data;
                if (!dragObj.isLeaf) {
                    const oldDocPrefix = oldKey.replace(`${docRoot}/`, '');
                    const newDocPrefix = newKey.replace(`${docRoot}/`, '');
                    finalData = SidebarAggregator.fixLinkIds(data, oldDocPrefix, newDocPrefix);
                }

                if (onItemMoved) onItemMoved(oldKey, newKey, dragObj.isLeaf ? 'file' : 'folder');
                this.setState({ treeData: finalData });
            } else {
                this.setState({ treeData: data });
            }
            this.markSidebarsDirty();

        }
    }


    commitAllChanges = async () => {
        const { treeData } = this.state;
        const { onCommitSuccess, vfsNodes, sidebarsDirty } = this.props;
        const docSetConfig = this.getDocSetConfig();
        const docRoot = docSetConfig.path;
        const nodes = Object.values(vfsNodes || {});
        let actions = [];

        nodes.forEach(node => {
            if (node.type !== 'file') return;
            const isAdded = !node.base.existsInGit && !node.current.isDeleted;
            const isDeleted = node.base.existsInGit && node.current.isDeleted;
            const isMoved = node.base.existsInGit && !node.current.isDeleted && node.base.path !== node.path;
            const isModified = node.base.existsInGit && !node.current.isDeleted && node.current.content !== node.base.content;

            if (isAdded) actions.push({ action: 'create', file_path: node.path, content: node.current.content });
            else if (isDeleted) actions.push({ action: 'delete', file_path: node.base.path });
            else if (isMoved) actions.push({ action: 'move', previous_path: node.base.path, file_path: node.path, content: node.current.content });
            else if (isModified) actions.push({ action: 'update', file_path: node.path, content: node.current.content });
        });

        // Sort: Deletes first (deepest first), then others (shallowest first)
        actions.sort((a, b) => {
            const isDeleteA = a.action === 'delete';
            const isDeleteB = b.action === 'delete';
            if (isDeleteA && !isDeleteB) return -1;
            if (!isDeleteA && isDeleteB) return 1;

            if (isDeleteA) {
                return b.file_path.length - a.file_path.length;
            } else {
                return a.file_path.length - b.file_path.length;
            }
        });

        if (sidebarsDirty) {
            const sidebarPath = docSetConfig.sidebarPath;
            const sidebarKey = docSetConfig.sidebarKey;
            let sidebarItems = {};
            try {
                const { content } = await oauth2Client.getFileByPath(sidebarPath);
                sidebarItems = JSON.parse(content);
            } catch (e) { }
            // 【稳健导出】传入 vfsNodes，确保导出的 sidebars.json 绝对不包含已删除或不存在的文件
            sidebarItems[sidebarKey] = SidebarAggregator.fromTreeData(treeData, docRoot, vfsNodes);
            actions.push({ action: 'update', file_path: sidebarPath, content: JSON.stringify(sidebarItems, null, 2) });
        }

        if (actions.length === 0) { return; }

        this.setState({ isCommitting: true });
        try {
            await oauth2Client.commitBatch(actions, `VFS Sync: ${actions.length} changes`);

            if (onCommitSuccess) onCommitSuccess();
        } catch (error) {
            console.error('提交失败:', error);
            message.error('提交失败：' + (error.message || '请检查网络或权限'));
        } finally {
            this.setState({ isCommitting: false });
        }
    }

    handleStagingItemClick = (c) => {
        if (c.type === 'S') {
            const structure = SidebarAggregator.fromTreeData(this.state.treeData, this.getDocRoot(), this.props.vfsNodes);
            console.log('%c[Staging Area] Current sidebars.json structure:', 'color: #007acc; font-weight: bold; background: #f0f0f0; padding: 2px 4px;', structure);
            return;
        }
        if (!c.key) return;

        // 1. 计算所有父级路径以便展开
        const parts = c.key.split('/');
        const newExpandKeys = [];
        let currentPath = '';
        parts.forEach((p, i) => {
            if (i < parts.length - 1) {
                currentPath = currentPath ? `${currentPath}/${p}` : p;
                newExpandKeys.push(currentPath);
            }
        });

        // 2. 更新状态：选中文件并展开父级
        this.setState(prevState => ({
            selectedKey: c.key,
            autoExpandKeys: [...new Set([...prevState.autoExpandKeys, ...newExpandKeys])]
        }), () => {
            // 3. 触发文件选择逻辑（加载内容）
            this.onSelect({ key: c.key, isLeaf: true });

            // 4. 滚动到可视化区域 (可选，如果树很长)
            setTimeout(() => {
                const element = document.querySelector(`[data-node-key="${c.key}"]`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }, 100);
        });
    }

    handleDiscardAll = () => {
        if (!window.confirm('确定要丢弃所有暂存的更改吗？此操作不可逆。')) return;

        // 1. 清空 VFS 缓存（AdminContent 会感知并清除 localStorage）
        this.props.updateVfsNodes({});

        // 2. 重置目录修改状态
        this.props.markSidebarsDirty?.(false);

        // 3. 重新加载当前树
        this.loadRootTree().then(() => {
            // 4. 如果当前有选中的文件，重新触发一次选择以静默刷新编辑器内容为基础版本
            if (this.state.selectedKey) {
                this.onSelect({ key: this.state.selectedKey, isLeaf: true });
            }
        });

        message.success('已丢弃所有本地更改');
    }

    markSidebarsDirty() {
        this.props.markSidebarsDirty?.();
    }


    render() {
        const {
            treeData, modalVisible, modalType, isCreating,
            modalAction, modalPath, searchValue, autoExpandKeys, selectedKey,
            contextMenuVisible, contextMenuX, contextMenuY, contextMenuNode,
        } = this.state;
        const docSetConfig = this.getDocSetConfig();
        const docRoot = docSetConfig.path;

        return (
            <div className="w-[280px] h-full overflow-hidden bg-[#f8f9fa] border-r border-[#e0e0e0] flex flex-col">
                <div className="px-4 pt-3 pb-2">
                    <div className="relative flex items-center bg-white border border-[#ddd] rounded h-8 px-2">
                        <span className="codicon codicon-search text-[#888] text-sm mr-2" />
                        <input
                            className="border-none outline-none flex-1 text-[13px] bg-transparent"
                            placeholder="搜索文档"
                            value={searchValue}
                            onChange={this.onSearch}
                        />
                        {searchValue && <span className="codicon codicon-close cursor-pointer text-xs text-[#999]" onClick={() => this.setState({ searchValue: '', autoExpandKeys: [] })} />}
                    </div>
                </div>

                <div className="h-9 px-4 flex justify-between items-center">
                    <span className="text-[11px] font-bold text-[#616161] uppercase tracking-wider">{docSetConfig.label}</span>
                    <div className="flex gap-1">
                        <button className="bg-transparent border-none w-6 h-6 flex items-center justify-center cursor-pointer text-[#616161] rounded transition-all duration-200 hover:bg-black/5 hover:text-[#1890ff]" title="新建文件" onClick={() => this.setState({ modalVisible: true, modalType: 'file', modalPath: docRoot, modalInputValue: '', modalAction: 'create' })}>
                            <span className="codicon codicon-new-file" />
                        </button>
                        <button className="bg-transparent border-none w-6 h-6 flex items-center justify-center cursor-pointer text-[#616161] rounded transition-all duration-200 hover:bg-black/5 hover:text-[#1890ff]" title="新建文件夹" onClick={() => this.setState({ modalVisible: true, modalType: 'folder', modalPath: docRoot, modalInputValue: '', modalAction: 'create' })}>
                            <span className="codicon codicon-new-folder" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto overflow-x-hidden p-px" onContextMenu={(e) => e.preventDefault()}>
                    <FileTree
                        treeData={treeData}
                        selectedKey={selectedKey}
                        onSelect={this.onSelect}
                        onContextMenu={this.handleContextMenu}
                        onDrop={this.onDrop}
                        searchValue={searchValue}
                        autoExpandKeys={autoExpandKeys}
                    />
                </div>

                <DocActionModal
                    visible={modalVisible}
                    type={modalType}
                    action={modalAction}
                    initialValue={modalAction === 'rename' ? modalPath.split('/').pop() : ''}
                    loading={isCreating}
                    onOk={this.handleModalOk}
                    onCancel={() => this.setState({ modalVisible: false })}
                />

                {contextMenuVisible && (
                    <ContextMenu
                        x={contextMenuX}
                        y={contextMenuY}
                        onClose={() => this.setState({ contextMenuVisible: false })}
                        items={(() => {
                            const hasReadmeLink = !contextMenuNode?.isLeaf && contextMenuNode?.categoryMeta?.link?.type === 'doc';
                            return [
                                { key: 'add_file', label: '新建文件', icon: <span className="codicon codicon-new-file" />, disabled: contextMenuNode?.isLeaf, onClick: () => this.handleContextMenuAction('add_file') },
                                { key: 'add_folder', label: '新建文件夹', icon: <span className="codicon codicon-new-folder" />, disabled: contextMenuNode?.isLeaf, onClick: () => this.handleContextMenuAction('add_folder') },
                                hasReadmeLink
                                    ? { key: 'unassign_readme', label: '取消目录页', icon: <span className="codicon codicon-bookmark" />, onClick: () => this.handleContextMenuAction('unassign_readme') }
                                    : { key: 'assign_readme', label: '设为目录页', icon: <span className="codicon codicon-bookmark" />, disabled: contextMenuNode?.isLeaf, onClick: () => this.handleContextMenuAction('assign_readme') },
                                { key: 'rename', label: '重命名', icon: <span className="codicon codicon-edit" />, disabled: contextMenuNode?.isLeaf && contextMenuNode?.title?.toLowerCase() === 'readme', onClick: () => this.handleContextMenuAction('rename') },
                                { type: 'divider' },
                                { key: 'delete', label: '删除', icon: <span className="codicon codicon-trash" />, danger: true, onClick: () => this.handleContextMenuAction('delete') }
                            ];
                        })()}
                    />
                )}



                <StagingArea
                    vfsNodes={this.props.vfsNodes}
                    sidebarsDirty={this.props.sidebarsDirty}
                    isCommitting={this.state.isCommitting}
                    onCommit={this.commitAllChanges}
                    onDiscard={this.handleDiscardAll}
                    onItemClick={this.handleStagingItemClick}
                />
            </div>
        );
    }
}

export default Sidebar;
