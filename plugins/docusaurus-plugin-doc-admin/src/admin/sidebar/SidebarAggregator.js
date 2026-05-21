/**
 * Sidebar 数据聚合与转换逻辑
 * 核心哲学：局部自愈 (Localized Self-Healing) —— 物理层级驱动的逻辑修复
 */

export const SidebarAggregator = {
    /**
     * 将 sidebars.json 转换为视图树
     */
    toTreeData(items, docSet, shaMap, vfsNodes = null) {
        const consumedPaths = new Set();

        // 物理目录索引
        const physicalFolderMap = {};
        Object.keys(shaMap).forEach(fullPath => {
            if (fullPath.startsWith(docSet + '/') && fullPath.endsWith('.md')) {
                const parts = fullPath.split('/');
                parts.pop();
                const folderPath = parts.join('/');
                if (!physicalFolderMap[folderPath]) physicalFolderMap[folderPath] = [];
                physicalFolderMap[folderPath].push(fullPath);
            }
        });

        const buildBranch = (itemList, currentFolderPath, parentLinkDocId = null) => {
            // 1. 先按配置处理 (保持顺序)
            let children = (itemList || []).map(item => {
                if (typeof item === 'string') {
                    const docPath = item.endsWith('.md') ? item : item + '.md';
                    const fullPath = docPath.startsWith(docSet + '/') ? docPath : `${docSet}/${docPath}`;
                    if (!shaMap[fullPath]) return null;

                    consumedPaths.add(fullPath);
                    const docId = docPath.endsWith('.md') ? docPath.slice(0, -3) : docPath;

                    // 【标识恢复】判断逻辑：只要 ID 匹配（支持绝对或相对末尾匹配）
                    const isLink = parentLinkDocId && (docId === parentLinkDocId || docId.endsWith('/' + parentLinkDocId));

                    if (vfsNodes && vfsNodes[fullPath]?.current?.isDeleted) return null;

                    return {
                        title: fullPath.split('/').pop().replace('.md', ''),
                        key: fullPath,
                        isLeaf: true,
                        sha: shaMap[fullPath],
                        isLink: isLink
                    };
                } else if (item.type === 'category') {
                    const label = item.label;
                    const categoryPath = currentFolderPath ? `${currentFolderPath}/${label}` : `${docSet}/${label}`;
                    const categoryLinkDocId = item.link?.type === 'doc' ? item.link.id : null;

                    return {
                        title: label,
                        key: categoryPath,
                        isLeaf: false,
                        categoryMeta: item,
                        children: buildBranch(item.items || [], categoryPath, categoryLinkDocId),
                    };
                }
                return null;
            }).filter(Boolean);

            const actualPhysicalFiles = physicalFolderMap[currentFolderPath] || [];
            actualPhysicalFiles.forEach(fPath => {
                if (!consumedPaths.has(fPath)) {
                    if (vfsNodes && vfsNodes[fPath]?.current?.isDeleted) {
                        consumedPaths.add(fPath);
                        return;
                    }
                    const docPath = fPath.startsWith(docSet + '/') ? fPath.substring(docSet.length + 1) : fPath;
                    const docId = docPath.endsWith('.md') ? docPath.slice(0, -3) : docPath;

                    // 【标识恢复】补全文件也要检测
                    const isLink = parentLinkDocId && (docId === parentLinkDocId || docId.endsWith('/' + parentLinkDocId));

                    children.push({
                        title: fPath.split('/').pop().replace('.md', ''),
                        key: fPath,
                        isLeaf: true,
                        sha: shaMap[fPath],
                        isOrphan: true,
                        isLink: isLink
                    });
                    consumedPaths.add(fPath);
                }
            });

            return children;
        };

        const initialTree = buildBranch(items, docSet);

        // 3. 极致孤儿处理
        Object.keys(shaMap).forEach(fPath => {
            if (fPath.startsWith(docSet + '/') && fPath.endsWith('.md') && !consumedPaths.has(fPath)) {
                if (vfsNodes && vfsNodes[fPath]?.current?.isDeleted) return;
                initialTree.push({
                    title: fPath.split('/').pop().replace('.md', ''),
                    key: fPath,
                    isLeaf: true,
                    sha: shaMap[fPath],
                    isOrphan: true,
                    isLink: false
                });
            }
        });

        return initialTree;
    },

    /**
     * 持久化导出
     */
    fromTreeData(treeData, docSet, vfsNodes = null) {
        const docsPrefix = docSet + '/';
        const seenPaths = new Set();

        const transform = (data, parentLinkDocId = null) => {
            return data.map(node => {
                if (node.isLeaf) {
                    if (vfsNodes && vfsNodes[node.key]?.current?.isDeleted) return null;

                    let docPath = node.key.startsWith(docsPrefix) ? node.key.substring(docsPrefix.length) : node.key;
                    if (docPath.endsWith('.md')) docPath = docPath.slice(0, -3);

                    if (parentLinkDocId && (docPath === parentLinkDocId || docPath.endsWith('/' + parentLinkDocId))) return null;
                    if (seenPaths.has(docPath)) return null;
                    seenPaths.add(docPath);

                    return docPath;
                } else {
                    const currentLinkDocId = node.categoryMeta?.link?.type === 'doc' ? node.categoryMeta.link.id : null;
                    const items = node.children ? transform(node.children, currentLinkDocId) : [];

                    return {
                        type: 'category',
                        label: node.title,
                        items: items.filter(Boolean),
                        link: node.categoryMeta?.link || (items.filter(Boolean).length === 0 ? { type: 'generated-index' } : undefined)
                    };
                }
            }).filter(Boolean);
        };

        return transform(treeData);
    },

    getCleanName(name, type) {
        if (!name) return '';
        if (type === 'file' && name.toLowerCase().endsWith('.md')) return name.slice(0, -3);
        return name;
    },

    /**
     * 生成节点的逻辑路径（用于树节点 key、sidebar doc ID 等）
     * - file: docs-h5/父级/文件名.md
     * - folder: docs-h5/父级/文件夹名
     */
    getNodePath(name, type, parentPath, docSet) {
        const cleanName = this.getCleanName(name, type);
        let base = parentPath || docSet;
        let full = base === docSet ? `${docSet}/${cleanName}` : `${base}/${cleanName}`;
        if (!full.startsWith(`${docSet}/`)) full = `${docSet}/${full}`;
        if (type === 'file') return full.endsWith('.md') ? full : full + '.md';
        return full;
    },

    /**
     * 生成文件夹在 Git 中的占位文件路径（仅用于 VFS commit）
     * - folder: docs-h5/父级/文件夹名/.gitkeep
     */
    getFolderGitKeepPath(folderPath) {
        return folderPath.endsWith('/') ? folderPath + '.gitkeep' : folderPath + '/.gitkeep';
    },

    fixLinkIds(list, oldPrefix, newPrefix) {
        return list.map(node => {
            let newNode = { ...node };
            if (!node.isLeaf) {
                if (node.categoryMeta?.link?.type === 'doc' && node.categoryMeta.link.id) {
                    const oldId = node.categoryMeta.link.id;
                    if (oldId === oldPrefix || oldId.startsWith(oldPrefix + '/')) {
                        const newId = newPrefix + oldId.substring(oldPrefix.length);
                        newNode.categoryMeta = { ...newNode.categoryMeta, link: { ...newNode.categoryMeta.link, id: newId } };
                    }
                }
                if (node.children) newNode.children = this.fixLinkIds(node.children, oldPrefix, newPrefix);
            }
            return newNode;
        });
    },

    /**
     * 为目录分配或清理 README 关联 (Link)
     * @param {Array} treeData 树数据
     * @param {string} folderPath 目标文件夹路径
     * @param {string} readmePath README 文件路径
     * @param {string} readmeId README 的 ID (如 V2H5文档/README)
     * @param {boolean} isDelete 是否为删除操作
     */
    assignReadme(treeData, folderPath, readmePath, readmeId, isDelete = false) {
        const updateNode = (nodes) => {
            return nodes.map(node => {
                if (node.key === folderPath && !node.isLeaf) {
                    const categoryMeta = { ...node.categoryMeta };
                    if (isDelete) {
                        // 只有当当前的 link 指向的是被删除的这个 ID 时才清理
                        if (categoryMeta.link?.type === 'doc' && categoryMeta.link.id === readmeId) {
                            delete categoryMeta.link;
                        }
                    } else {
                        categoryMeta.link = { type: 'doc', id: readmeId };
                    }

                    const children = node.children ? node.children.map(child => {
                        if (child.isLeaf) {
                            let childDocId = child.key;
                            if (childDocId.endsWith('.md')) childDocId = childDocId.slice(0, -3);
                            // 检测是否匹配 README ID (支持全路径匹配或以 / 分隔的末尾匹配)
                            const isLink = !isDelete && (childDocId === readmeId || childDocId.endsWith('/' + readmeId));
                            return { ...child, isLink };
                        }
                        return child;
                    }) : node.children;

                    return { ...node, categoryMeta, children };
                }
                if (node.children) {
                    return { ...node, children: updateNode(node.children) };
                }
                return node;
            });
        };
        return updateNode(treeData);
    }
};
