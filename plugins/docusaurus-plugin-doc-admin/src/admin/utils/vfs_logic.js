/**
 * VFS 逻辑助手 (Minimal & State-Driven)
 */

export class VfsNode {
    constructor(data) {
        this.path = data.path;
        this.type = data.type || 'file';
        this.title = data.title || data.path.split('/').pop();

        this.base = {
            path: data.basePath || data.path,
            sha: data.baseSha || null,
            content: data.baseContent ?? null,
            existsInGit: !!data.basePath || false
        };

        this.current = {
            content: data.content ?? data.baseContent ?? null,
            isDeleted: false,
            title: this.title
        };

        this.metadata = data.metadata || {};
    }

    getStatus() {
        if (this.current.isDeleted) return 'deleted';
        if (!this.base.existsInGit) return 'added';

        const isMoved = this.base.path !== this.path;
        const isModified = this.current.content !== this.base.content;

        if (isMoved && isModified) return 'moved_modified';
        if (isMoved) return 'moved';
        if (isModified) return 'modified';

        return 'synced';
    }
}

export class VfsManager {
    constructor() {
        this.nodes = new Map();
    }

    /**
     * 【稳健初始化】
     * 1. 根据 sidebars.json 建立逻辑节点
     * 2. 将剩余的 Git 物理文件补全为“孤儿节点”，确保 100% 覆盖
     */
    initialize(sidebarsItems, docSet, gitTree) {
        this.nodes.clear();
        // 剩余待处理的物理路径池
        const gitPaths = new Set(Object.keys(gitTree).filter(p => !p.includes('/_meta/') && p.startsWith(docSet + '/')));

        const registerNode = (item, parentPath) => {
            if (typeof item === 'string') {
                const docPath = item.endsWith('.md') ? item : item + '.md';
                const fullPath = docPath.startsWith(docSet + '/') ? docPath : `${docSet}/${docPath}`;

                const exists = gitPaths.has(fullPath);
                const node = new VfsNode({
                    path: fullPath,
                    basePath: exists ? fullPath : null,
                    baseSha: gitTree[fullPath],
                    type: 'file',
                    title: fullPath.split('/').pop().replace('.md', '')
                });

                this.nodes.set(fullPath, node);
                gitPaths.delete(fullPath); // 标记已被侧边栏“领养”
            } else if (item.type === 'category') {
                const label = item.label;
                const guessPath = parentPath ? `${parentPath}/${label}` : `${docSet}/${label}`;

                const node = new VfsNode({
                    path: guessPath,
                    basePath: gitTree[guessPath] ? guessPath : null,
                    type: 'folder',
                    title: label,
                    metadata: { ...item }
                });
                this.nodes.set(guessPath, node);

                if (item.items) {
                    item.items.forEach(child => registerNode(child, guessPath));
                }

                if (item.link?.type === 'doc' && item.link.id) {
                    const rPath = item.link.id.endsWith('.md') ? item.link.id : item.link.id + '.md';
                    const fPath = rPath.startsWith(docSet + '/') ? rPath : `${docSet}/${rPath}`;
                    if (gitPaths.has(fPath)) {
                        const rNode = new VfsNode({
                            path: fPath,
                            basePath: fPath,
                            baseSha: gitTree[fPath],
                            type: 'file',
                            title: fPath.split('/').pop().replace('.md', '')
                        });
                        this.nodes.set(fPath, rNode);
                        gitPaths.delete(fPath); // 标记被领养
                    }
                }
            }
        };

        // 1. 处理配置中的显式项
        (sidebarsItems || []).forEach(item => registerNode(item, null));

        // 2. 核心：处理遗漏的物理文件 (孤儿文件)
        gitPaths.forEach(restPath => {
            if (restPath.endsWith('.md')) {
                const node = new VfsNode({
                    path: restPath,
                    basePath: restPath,
                    baseSha: gitTree[restPath],
                    type: 'file',
                    title: restPath.split('/').pop().replace('.md', '')
                });
                this.nodes.set(restPath, node);
            }
        });
    }

    getDiffs() {
        const diffs = [];
        this.nodes.forEach(node => {
            const status = node.getStatus();
            if (status !== 'synced') {
                diffs.push({
                    path: node.path,
                    basePath: node.base.path,
                    status: status,
                    type: node.type
                });
            }
        });
        return diffs;
    }

    updateContent(path, newContent) {
        const node = this.nodes.get(path);
        if (node) node.current.content = newContent;
    }

    moveNode(oldPath, newPath) {
        const node = this.nodes.get(oldPath);
        if (!node) return;

        const children = [];
        if (node.type === 'folder') {
            this.nodes.forEach((child, path) => {
                if (path.startsWith(oldPath + '/')) children.push(child);
            });
            children.forEach(child => this.nodes.delete(child.path));
        }

        this.nodes.delete(oldPath);
        node.path = newPath;
        this.nodes.set(newPath, node);

        children.forEach(child => {
            const childNewPath = child.path.replace(oldPath, newPath);
            child.path = childNewPath;
            this.nodes.set(childNewPath, child);
        });
    }
}
