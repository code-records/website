import React from "react";
import { Editor } from "./editor";
import Preview from "./preview";
import Sidebar from "./sidebar";
import Resizer from "./components/Resizer";
import Login from "./components/Login";
import GitlabCICD from "./components/GitlabCICD";
import ToastContainer from "./components/Toast";
import { DiffModal } from "./components/DiffModal";
import { message } from "./utils/message";
import { oauth2Client } from "./oauth2";

import './admin.css';
import '@vscode/codicons/dist/codicon.css';
import { initCOS } from "./utils/cos_utils";
import { applyCompat } from "./compat";

import { normalizeDocSets } from "./docsets.config";

export default class AdminContent extends React.Component {
    constructor(props) {
        super(props);

        const pluginOptions = props.pluginOptions || {};
        this.docSets = normalizeDocSets(pluginOptions.docSets);
        const docSetParam = new URLSearchParams(window.location.search).get('docSet');
        const initialDocSet = this.docSets[docSetParam] ? docSetParam : Object.keys(this.docSets)[0];

        let initialVfsNodes = {};
        try {
            const cachedVfs = localStorage.getItem(`admin-vfs-cache-${initialDocSet}`);
            if (cachedVfs) {
                initialVfsNodes = JSON.parse(cachedVfs);
            }
        } catch (e) { }

        this.state = {
            markdown: '',
            currentPath: '',
            currentSha: null,
            originalMarkdown: '',
            userInfo: null,
            docSet: initialDocSet,
            // VFS 核心状态: path -> VfsNode 数据
            vfsNodes: initialVfsNodes,
            sidebarsDirty: false,
            isLoading: true,
            // Diff 弹窗状态
            diffModal: null,
        };

        this.sidebarRef = React.createRef();
        this.cicdRef = React.createRef();
    }


    async componentDidMount() {
        window.addEventListener('beforeunload', this.handleBeforeUnload);
        window.addEventListener('keydown', this.handleKeyDown);

        const isAuthCallback = new URLSearchParams(window.location.search).has('code');
        try {
            if (isAuthCallback) {
                await oauth2Client.handleCallback();
            }

            const user = await oauth2Client.getUser();
            this.setState({ userInfo: user, isLoading: false });
            if (isAuthCallback) {
                message.success('Gitee 登录成功');
            }
            const hasDirtyNodes = Object.values(this.state.vfsNodes).some(n => this.isNodeDirty(n));
            if (hasDirtyNodes) {
                setTimeout(() => message.info('已自动恢复上次未提交的草稿'), 500);
            }
            // 登录成功后，尝试加载 COS 配置
            this.loadSecrets();
        } catch (err) {
            if (isAuthCallback) {
                message.error('Gitee 登录失败：接口请求被拦截或 Token 无效');
            }
            console.warn("未登录或 Token 无效", err);
            this.setState({ isLoading: false });
        }
    }

    loadSecrets = async () => {
        try {
            // 从 Gitee 获取配置文件
            const res = await oauth2Client.getFileByPath('admin/_config/secrets.json');
            if (res && res.content) {
                const config = JSON.parse(res.content);
                if (config.cos) {
                    initCOS(config.cos);
                    console.log('[Admin] COS 配置加载成功');
                }
            }
        } catch (e) {
            console.warn('[Admin] 无法加载 secrets.json, COS 映射可能失效:', e);
        }
    }

    componentWillUnmount() {
        window.removeEventListener('beforeunload', this.handleBeforeUnload);
        window.removeEventListener('keydown', this.handleKeyDown);
    }

    componentDidUpdate(prevProps, prevState) {
        // docSet 切换时：先用旧 key 保存旧 docSet 的数据，再加载新 docSet 的缓存
        if (prevState.docSet !== this.state.docSet) {
            this.saveVfsCache(prevState.vfsNodes, prevState.docSet);
            this.loadVfsCache(this.state.docSet);
        } else if (prevState.vfsNodes !== this.state.vfsNodes) {
            // 仅在 docSet 没变时才存当前缓存，避免切换时重复/错误写入
            this.saveVfsCache(this.state.vfsNodes, this.state.docSet);
        }
    }

    // 判断一个 VFS 节点是否有实际变更（文件或文件夹通用）
    isNodeDirty = (node) => {
        if (node.type === 'file') {
            const isModified = node.current.content !== node.base.content;
            const isMoved = node.base.path !== node.path;
            const isAdded = !node.base.existsInGit && !node.current.isDeleted;
            const isDeleted = node.base.existsInGit && node.current.isDeleted;
            return isModified || isMoved || isAdded || isDeleted;
        }
        // folder: 只缓存被删除或被重命名的，其他 folder 从 Git 重建即可
        const isDeleted = node.current.isDeleted;
        const isRenamed = node.base.path !== node.path;
        return isDeleted || isRenamed;
    }

    saveVfsCache = (vfsNodes, docSet) => {
        const cacheKey = `admin-vfs-cache-${docSet}`;
        const nodesToCache = {};
        let count = 0;
        Object.keys(vfsNodes).forEach(key => {
            const node = vfsNodes[key];
            if (this.isNodeDirty(node)) {
                nodesToCache[key] = node;
                count++;
            }
        });

        if (count > 0) {
            try {
                localStorage.setItem(cacheKey, JSON.stringify(nodesToCache));
            } catch (e) {
                message.error('草稿缓存失败：浏览器存储已满');
            }
        } else {
            localStorage.removeItem(cacheKey);
        }
    }

    loadVfsCache = (docSet) => {
        const cached = localStorage.getItem(`admin-vfs-cache-${docSet}`);
        this.setState({ vfsNodes: cached ? JSON.parse(cached) : {} });
    }

    handleKeyDown = (e) => {
        // Ctrl+S: 保存到暂存区
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            this.handleSave();
        }
        // Ctrl+Enter: 提交所有暂存更改
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (this.sidebarRef.current) {
                this.sidebarRef.current.commitAllChanges();
            }
        }
    }

    handleBeforeUnload = (e) => {
        if (this.state.markdown !== this.state.originalMarkdown || this.getPendingFileCount() > 0) {
            e.preventDefault();
            e.returnValue = ''; // Trigger browser confirmation dialog
        }
    }



    onChangeMarkdown = (data) => {
        const { currentPath } = this.state;
        const compattedData = applyCompat(data);

        this.setState({ markdown: compattedData });

        // 实时更新暂存区
        if (currentPath) {
            this.saveToStaging(currentPath, compattedData);
        }
    };

    // Ctrl+S 快捷键处理
    handleSave = () => {
        const { currentPath, markdown, originalMarkdown } = this.state;
        if (!currentPath) {
            message.warning('请先选择一个文件');
            return;
        }

        if (markdown === originalMarkdown) {
            message.info('文件内容未修改');
        } else {
            message.info('修改已在暂存区，点击"提交"同步到 Git');
        }
    }

    // 保存文件到 VFS 暂存区
    saveToStaging = (path, content) => {
        this.setState(prev => {
            const vfsNodes = { ...prev.vfsNodes };
            if (vfsNodes[path]) {
                vfsNodes[path] = {
                    ...vfsNodes[path],
                    current: { ...vfsNodes[path].current, content }
                };
            }
            return { vfsNodes };
        });
    }

    // 统一处理路径变更 (VFS 模式)
    handleItemMoved = (oldPath, newPath, type) => {
        this.setState(prev => {
            const vfsNodes = { ...prev.vfsNodes };
            let currentPath = prev.currentPath;

            if (type === 'file') {
                const node = vfsNodes[oldPath];
                if (node) {
                    vfsNodes[newPath] = { ...node, path: newPath };
                    delete vfsNodes[oldPath];
                }
                if (currentPath === oldPath) currentPath = newPath;
            } else {
                // 递归更新目录下所有节点
                Object.keys(vfsNodes).forEach(path => {
                    if (path === oldPath || path.startsWith(oldPath + '/')) {
                        const node = vfsNodes[path];
                        const updatedPath = path.replace(oldPath, newPath);
                        vfsNodes[updatedPath] = { ...node, path: updatedPath };
                        delete vfsNodes[path];

                        if (currentPath === path) currentPath = updatedPath;
                    }
                });
            }

            return { vfsNodes, currentPath };
        });
    }

    // 标记侧边栏已修改
    markSidebarsDirty = (isDirty = true) => {
        this.setState({ sidebarsDirty: isDirty });
    }

    /**
     * Diff 冲突解决
     *
     * 两条路径都会将 base.sha 更新为 freshSha，使冲突不再重复触发：
     *
     * 使用远程版本：base = current = 远程 → 节点 clean → 缓存自动清除，暂存区消失
     * 保留本地草稿：base = 远程, current = 草稿 → 节点 dirty → 缓存保留，暂存区显示 M，提交后清理
     */
    handleDiffUseLocal = () => {
        const { diffModal } = this.state;
        const { filePath, remoteContent, freshSha } = diffModal;

        this.setState(prev => {
            const vfsNodes = { ...prev.vfsNodes };
            if (vfsNodes[filePath]) {
                vfsNodes[filePath] = {
                    ...vfsNodes[filePath],
                    base: { ...vfsNodes[filePath].base, content: remoteContent, sha: freshSha },
                    _conflict: undefined,
                };
            }
            return { vfsNodes, diffModal: null, originalMarkdown: remoteContent };
        });
        message.success('已保留你的草稿');
    }

    handleDiffUseRemote = () => {
        const { diffModal } = this.state;
        const { filePath, remoteContent, freshSha } = diffModal;

        this.setState(prev => {
            const vfsNodes = { ...prev.vfsNodes };
            if (vfsNodes[filePath]) {
                vfsNodes[filePath] = {
                    ...vfsNodes[filePath],
                    base: { ...vfsNodes[filePath].base, content: remoteContent, sha: freshSha },
                    current: { ...vfsNodes[filePath].current, content: remoteContent },
                    _conflict: undefined,
                };
            }
            return {
                vfsNodes,
                diffModal: null,
                markdown: prev.currentPath === filePath ? remoteContent : prev.markdown,
                originalMarkdown: remoteContent,
            };
        });
        message.success('已切换到远程版本');
    }

    // Sidebar 回调：文件选择
    handleFileSelect = (path, sha, content) => {
        const { currentPath, markdown, originalMarkdown } = this.state;

        // 如果当前文件有修改，自动保存到暂存区
        if (currentPath && markdown !== originalMarkdown) {
            this.saveToStaging(currentPath, markdown);
        }

        const normalizedContent = content || '';

        this.setState(prev => {
            const vfsNodes = { ...prev.vfsNodes };

            // 同步内容到 VFS (惰性确立基准)
            if (vfsNodes[path] && vfsNodes[path].base.content === null && vfsNodes[path].base.existsInGit) {
                const existingCurrentContent = vfsNodes[path].current.content;
                vfsNodes[path] = {
                    ...vfsNodes[path],
                    base: { ...vfsNodes[path].base, content: normalizedContent },
                    current: {
                        ...vfsNodes[path].current,
                        content: (existingCurrentContent !== null && existingCurrentContent !== undefined)
                            ? existingCurrentContent
                            : normalizedContent
                    }
                };
            }

            // 冲突检测：远程文件在用户上次编辑后被修改过 → 弹出 Diff 对比
            if (vfsNodes[path] && vfsNodes[path]._conflict) {
                const localContent = vfsNodes[path].current.content;
                const remoteContent = normalizedContent;
                // 立即将 base.sha 更新为 freshSha，确保即使用户未点击解决按钮就刷新，
                // 缓存中也不会残留旧 SHA 导致下次 blend 再次误判为冲突
                vfsNodes[path] = {
                    ...vfsNodes[path],
                    base: { ...vfsNodes[path].base, sha },
                    _conflict: undefined,
                };

                // 延迟弹窗，等 setState 完成
                setTimeout(() => this.setState({
                    diffModal: { filePath: path, remoteContent, localContent, freshSha: sha }
                }), 0);
            }

            // 优先使用 VFS 里的草稿内容
            const hasDraft = vfsNodes[path] && vfsNodes[path].current;
            const finalMarkdown = hasDraft ? vfsNodes[path].current.content : normalizedContent;
            const finalOriginal = hasDraft ? vfsNodes[path].base.content : normalizedContent;

            return {
                vfsNodes,
                markdown: finalMarkdown,
                originalMarkdown: finalOriginal,
                currentPath: path,
                currentSha: sha,
            };
        });
    }

    handleDocSetChange = (value) => {
        const { currentPath, markdown, originalMarkdown } = this.state;

        // 如果当前文件有修改，自动保存到暂存区
        if (currentPath && markdown !== originalMarkdown) {
            this.saveToStaging(currentPath, markdown);
        }

        // 更新 URL 参数
        const url = new URL(window.location);
        url.searchParams.set('docSet', value);
        window.history.pushState({}, '', url);

        // 直接切换文档库
        this.setState({
            docSet: value,
            currentPath: '',
            markdown: '',
            originalMarkdown: '',
            currentSha: null,
        });
    }

    // 获取暂存区文件数量 (从 VFS 计算)
    getPendingFileCount = () => {
        const { vfsNodes } = this.state;
        return Object.values(vfsNodes).filter(node =>
            node.type === 'file' && this.isNodeDirty(node)
        ).length;
    }

    // Sidebar 提交成功后的回调
    handleCommitSuccess = () => {
        // 全局刷新状态，将 current 变为新的 base (仿 Web IDE 同步)
        this.setState(prev => {
            const vfsNodes = { ...prev.vfsNodes };
            Object.keys(vfsNodes).forEach(path => {
                const node = vfsNodes[path];
                if (node.current.isDeleted) {
                    delete vfsNodes[path];
                } else {
                    vfsNodes[path] = {
                        ...node,
                        base: {
                            ...node.base,
                            path: node.path,
                            content: node.current.content,
                            existsInGit: true
                        }
                    };
                }
            });
            return {
                vfsNodes,
                sidebarsDirty: false,
                originalMarkdown: prev.markdown
            };
        });

        // 提交成功后立即刷新 CI/CD 状态并开始轮询
        if (this.cicdRef.current) {
            // 传入一个 10 秒后的时间戳，强制组件在此期间持续检测新 Pipeline
            const forceUntil = Date.now() + 10000;
            this.cicdRef.current.fetchStatus(forceUntil);
        }
    }

    // Sidebar 回调：文件删除后
    handleFileDeleted = () => {
        this.setState({
            currentPath: '',
            markdown: '',
            originalMarkdown: '',
            currentSha: null,
        });
    }

    // Sidebar 回调：文件创建后
    handleFileCreated = (path, title, content) => {
        const normalizedContent = applyCompat(content.trim());
        this.setState(prev => {
            const vfsNodes = { ...prev.vfsNodes };
            vfsNodes[path] = {
                path,
                type: 'file',
                title,
                base: { path: null, sha: null, content: '', existsInGit: false },
                current: { content: normalizedContent, isDeleted: false }
            };
            return {
                vfsNodes,
                markdown: normalizedContent,
                originalMarkdown: '',
                currentPath: path,
                currentSha: null
            };
        });
    }

    // Sidebar 回调：文件重命名后 (旧接口，保留兼容或统一由 handleItemMoved 处理)
    handleFileRenamed = (newPath) => {
        // 实际上 handleItemMoved 已经涵盖了此逻辑，如果是外部触发可调用此
        this.setState({ currentPath: newPath });
    }

    render() {
        const { markdown, originalMarkdown, currentPath, userInfo, docSet } = this.state;
        const docSetConfig = this.docSets[docSet];

        return (
            <div>
                <ToastContainer />
                <DiffModal
                    visible={!!this.state.diffModal}
                    filePath={this.state.diffModal?.filePath}
                    remoteContent={this.state.diffModal?.remoteContent}
                    localContent={this.state.diffModal?.localContent}
                    onUseLocal={this.handleDiffUseLocal}
                    onUseRemote={this.handleDiffUseRemote}
                />
                {this.state.isLoading ? (
                    <div className="h-screen flex items-center justify-center bg-white text-[#666] text-sm">
                        <div className="flex flex-col items-center gap-4">
                            <span className="badge-processing inline-flex items-center justify-center h-4 min-w-[16px] px-1 text-[10px] font-semibold leading-4 text-white bg-[#1890ff] rounded-[10px] relative" />
                            <span>身份验证中...</span>
                        </div>
                    </div>
                ) : (!this.state.userInfo ? (
                    <Login />
                ) : (
                    <div className="admin h-screen flex flex-col bg-white text-[#1c1e21] overflow-hidden">
                        <header className="h-[50px] bg-white border-b border-[var(--admin-border-color)] flex items-center px-4 z-[100]">
                            <div className="flex flex-none items-center justify-start">
                                <a href="/" className="flex shrink-0 items-center whitespace-nowrap font-semibold text-[var(--ifm-navbar-link-color)] text-[0.95rem] no-underline">
                                    <span>文档管理</span>
                                </a>
                                <div className="ml-6 flex shrink-0 whitespace-nowrap bg-[#f0f2f5] rounded-md gap-0.5 p-0.5 relative before:content-[''] before:absolute before:-left-3 before:top-1.5 before:bottom-1.5 before:w-px before:bg-[var(--admin-border-color)]">
                                    {Object.keys(this.docSets).map(key => (
                                        <button
                                            key={key}
                                            className={`shrink-0 whitespace-nowrap border-none bg-transparent px-3 py-1 text-[0.85rem] cursor-pointer rounded text-[#666] transition-all duration-200 font-medium hover:text-[var(--ifm-color-primary)] ${docSet === key ? '!bg-white !text-[var(--ifm-color-primary)] !shadow-[0_1px_3px_rgba(0,0,0,0.1)]' : ''}`}
                                            onClick={() => docSet !== key && this.handleDocSetChange(key)}
                                        >
                                            {this.docSets[key].label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex min-w-0 flex-1 items-center justify-center">
                                <GitlabCICD ref={this.cicdRef} />
                            </div>
                            <div className="flex flex-none items-center justify-end">
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center px-1">
                                        <span className="text-[#888] text-[0.85rem] font-normal font-mono">{userInfo.username}</span>
                                    </div>
                                    <button onClick={() => oauth2Client.logout()} className="!h-7 !px-3 !text-[13px] !font-medium !text-[#444] !bg-white !border !border-[#d1d5db] !rounded-md !shadow-sm !transition-all !duration-200 !flex !items-center hover:!text-[#dc2626] hover:!border-[#fca5a5] hover:!bg-[#fef2f2]">
                                        退出
                                    </button>
                                </div>
                            </div>
                        </header>
                        <div className="flex-1 flex overflow-hidden">
                            <Sidebar
                                ref={this.sidebarRef}
                                docSet={docSet}
                                docSetConfig={docSetConfig}
                                currentPath={currentPath}
                                // VFS 核心
                                vfsNodes={this.state.vfsNodes}
                                sidebarsDirty={this.state.sidebarsDirty}
                                // 回调
                                onFileSelect={this.handleFileSelect}
                                onFileDeleted={this.handleFileDeleted}
                                onFileCreated={this.handleFileCreated}
                                onItemMoved={this.handleItemMoved}
                                onCommitSuccess={this.handleCommitSuccess}
                                markSidebarsDirty={this.markSidebarsDirty}
                                updateVfsNodes={(nodes) => this.setState({ vfsNodes: nodes })}
                            />
                            <main className="flex-1 flex overflow-hidden bg-white">
                                {currentPath ? (
                                    <Resizer
                                        defaultRatio={0.5}
                                        minRatio={0.25}
                                        maxRatio={0.8}
                                        storageKey="admin-editor-split-ratio"
                                        leftMinWidth={400}
                                        rightMinWidth={300}
                                        left={
                                            <Editor
                                                key={currentPath}
                                                markdown={markdown}
                                                currentPath={currentPath}
                                                onChange={this.onChangeMarkdown}
                                            />
                                        }
                                        right={<Preview markdown={markdown} />}
                                    />
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center bg-[#fbfbfb] text-[#888]">
                                        <span className="codicon codicon-markdown !text-[64px] text-[#e0e0e0] mb-6" />
                                        <h3 className="m-0 mb-2 text-[#333] text-lg">开始编辑文档</h3>
                                        <p className="text-sm text-[#999]">从左侧目录选择一个文件进行编辑，或创建新文件</p>
                                        <div className="mt-12 flex flex-col gap-3">
                                            <div className="text-xs text-[#bbb]">
                                                <kbd className="bg-[#eee] px-1.5 py-0.5 rounded text-[#666] border border-[#ddd]">Ctrl</kbd> + <kbd className="bg-[#eee] px-1.5 py-0.5 rounded text-[#666] border border-[#ddd]">S</kbd> 快速保存到暂存区
                                            </div>
                                            <div className="text-xs text-[#bbb]">
                                                <kbd className="bg-[#eee] px-1.5 py-0.5 rounded text-[#666] border border-[#ddd]">Ctrl</kbd> + <kbd className="bg-[#eee] px-1.5 py-0.5 rounded text-[#666] border border-[#ddd]">Enter</kbd> 提交所有修改
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </main>
                        </div>
                    </div>
                ))
                }
            </div>
        );
    }
}
