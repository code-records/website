import React from 'react';
import { Chat } from '../../../agent';
import { CodeAgent } from '../CodeAgent';
import ChatMessage from '../../doc-agent/ui/ChatMessage.jsx';
import SuggestMessage from '../../doc-agent/ui/SuggestMessage.jsx';
import { 
    queryFileSystemDirectoryHandle, 
    requestFileSystemDirectoryHandle, 
    disposeFileSystemDirectoryHandle 
} from '../../../agent/tools/browser/browserFileSystemHelper';

const WELCOME_MESSAGE = '你好！我是 CodeAgent 极客编程助手。我已经搭载了物理文件读写工具，授权连接本地代码库后，我可以直接读取、诊断并物理重写你工作区下的代码，让我们开始吧！';

function getProviderByModel(providers, modelId) {
    for (const provider of Object.values(providers || {})) {
        if (Object.prototype.hasOwnProperty.call(provider.models || {}, modelId)) {
            return provider;
        }
    }
    return null;
}

export class CodePanel extends React.Component {
    constructor(props) {
        super(props);
        const pluginOptions = props.pluginOptions;
        if (!getProviderByModel(pluginOptions.providers, pluginOptions.defaultModel)) {
            throw new Error(
                `docusaurus-plugin-doc-agent defaultModel "${pluginOptions.defaultModel}" must exist in providers.`,
            );
        }
        this.state = {
            inputValue: '',
            model: pluginOptions.defaultModel,
            directoryHandle: null,
            workspaceFiles: [],
        };
        this.messagesAreaRef = React.createRef();
        this.inputRef = React.createRef();

        this.agent = CodeAgent.instance;
        this.agent.configure(pluginOptions);

        this.chat = new Chat({
            agent: this.agent,
            model: pluginOptions.defaultModel,
            setAgentModel: (agent, model) => agent.setCurrentModel(model),
            onChange: () => {
                this.forceUpdate();
            },
        });
    }

    componentDidMount() {
        this.scrollToBottom();
        this.pushSuggestions();

        // 尝试静默恢复昨日已授权的本地工作区
        queryFileSystemDirectoryHandle().then(handle => {
            if (handle) {
                this.setState({ directoryHandle: handle }, () => {
                    this.bindDirectoryHandle(handle);
                    this.loadWorkspaceTree();
                });
            }
        }).catch(err => {
            console.warn('[CodeAgent] 初始化静默恢复本地工作区失败:', err);
        });
    }

    componentDidUpdate(prevProps) {
        if (this.chat.isSending || this.chat.messages.length > 0) {
            this.scrollToBottom();
        }
    }

    bindDirectoryHandle = (handle) => {
        this.agent.setDirectoryHandle(handle);
        if (this.agent.config.debug) {
            console.log('[DocsAgent] 已通过引擎动态装配 BrowserFileTool。当前工具集:', this.agent.tools);
        }
    };

    loadWorkspaceTree = async () => {
        const { directoryHandle } = this.state;
        if (!directoryHandle) {
            this.setState({ workspaceFiles: [] });
            return;
        }
        try {
            const items = [];
            // 异步遍历获取目录下的所有条目
            for await (const [name, handle] of directoryHandle.entries()) {
                items.push({ name, kind: handle.kind });
            }
            // 目录优先展示，随后按字母排序
            items.sort((a, b) => {
                if (a.kind !== b.kind) {
                    return a.kind === 'directory' ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });
            this.setState({ workspaceFiles: items }, () => {
                this.pushSuggestions();
            });
        } catch (e) {
            console.error('[CodeAgent] 加载本地目录树异常:', e);
        }
    };

    handleConnectDirectory = async () => {
        try {
            const handle = await requestFileSystemDirectoryHandle();
            if (handle) {
                this.setState({ directoryHandle: handle }, () => {
                    this.bindDirectoryHandle(handle);
                    this.loadWorkspaceTree();
                });
            }
        } catch (err) {
            console.warn('[CodeAgent] 授权连接被取消或失败:', err);
        }
    };

    handleDisconnectDirectory = async () => {
        try {
            await disposeFileSystemDirectoryHandle();
            this.setState({ directoryHandle: null, workspaceFiles: [] }, () => {
                this.bindDirectoryHandle(null);
                this.pushSuggestions();
            });
        } catch (err) {
            console.error('[CodeAgent] 断开授权连接异常:', err);
        }
    };

    pushSuggestions = async () => {
        const { directoryHandle, workspaceFiles, model } = this.state;

        // 1. 若已连接工作区且有文件列表，由 AI 根据项目结构动态生成高匹配度推荐问题
        if (directoryHandle && workspaceFiles.length > 0) {
            try {
                // 仅提取前 20 个根目录条目名称作为项目简要特征
                const files = workspaceFiles.slice(0, 20).map(f => `${f.name} [${f.kind}]`);
                const dynamicQuestions = await this.agent.suggestWorkspaceQuestions({
                    model,
                    files
                });

                if (dynamicQuestions && dynamicQuestions.trim().length > 0) {
                    const suggestionsMsg = {
                        role: 'assistant',
                        content: dynamicQuestions,
                        local: true,
                        custom: 'suggest',
                    };
                    const lastMsg = this.chat.messages[this.chat.messages.length - 1];
                    if (lastMsg && lastMsg.custom === 'suggest') {
                        this.chat.removeLastMessage();
                    }
                    this.chat.addMessage(suggestionsMsg);
                    return;
                }
            } catch (err) {
                console.warn('[CodeAgent] 动态推荐问题生成异常:', err);
            }
        }

        // 2. 兜底策略：未授权或无文件列表时，保持界面彻底纯白清净，删除任何多余的静态推荐消息
        const lastMsg = this.chat.messages[this.chat.messages.length - 1];
        if (lastMsg && lastMsg.custom === 'suggest') {
            this.chat.removeLastMessage();
        }
    };

    scrollToBottom = () => {
        const el = this.messagesAreaRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    };

    handleInputChange = (e) => {
        this.setState({ inputValue: e.target.value });
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    };

    handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSend();
        }
    };

    handleModelChange = (e) => {
        const model = e.target.value;
        if (!this.chat.setModel(model)) return;
        this.setState({ model });
    };

    handleSend = async () => {
        const { inputValue } = this.state;
        const question = inputValue.trim();
        if (!question || this.chat.isSending) return;

        if (this.inputRef.current) this.inputRef.current.style.height = 'auto';
        this.setState({ inputValue: '' });

        await this.chat.send(question);
    };

    handleStop = () => {
        this.chat.stop();
    };

    handleSuggestionClick = async (question) => {
        if (!question || this.chat.isSending) return;
        await this.chat.send(question);
    };

    handleCopyChat = () => {
        navigator.clipboard.writeText(JSON.stringify(this.chat.toJSON(), null, 2));
    };

    handleCopyDisplay = () => {
        const text = this.messagesAreaRef.current?.innerText;
        if (text) navigator.clipboard.writeText(text);
    };

    handleClearHistory = () => {
        this.chat.clear();
        this.pushSuggestions();
    };



    hasConversationMessages = () => {
        return this.chat.messages.some(message => message.custom !== 'suggest');
    };

    renderMessage = (message, idx) => {
        if (message.custom === 'suggest') {
            return (
                <SuggestMessage
                    key={idx}
                    message={message}
                    onSelectSuggestion={this.handleSuggestionClick}
                    floating={false}
                />
            );
        }
        return (
            <ChatMessage
                key={idx}
                message={message}
                isStreaming={message.streaming}
                onTogglePlan={message.streaming ? i => this.chat.togglePlan(i) : undefined}
            />
        );
    };

    renderMessages = () => {
        return this.chat.messages.map((message, idx) => this.renderMessage(message, idx));
    };

    render() {
        const { inputValue, model, directoryHandle, workspaceFiles } = this.state;
        const isLoading = this.chat.isSending;
        const hasRealMessages = this.hasConversationMessages();

        return (
            <div className="flex w-full h-screen bg-[var(--ifm-background-color)] text-[var(--ifm-font-color-base)] overflow-hidden font-mono antialiased selection:bg-cyan-500/20">
                {/* 1. 左侧工作区文件树（自适应明亮主题） */}
                <div className="w-72 bg-[var(--ifm-color-emphasis-100)] border-r border-[var(--ifm-color-emphasis-200)] flex flex-col shrink-0">
                    {/* 目录树 Header */}
                    <div className="p-4 border-b border-[var(--ifm-color-emphasis-200)] flex items-center justify-between shrink-0">
                        <span className="text-xs font-bold tracking-widest text-[var(--ifm-color-primary)] flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--ifm-color-primary)] animate-pulse" />
                            WORKSPACE EXPLORER
                        </span>
                        {directoryHandle && (
                            <button 
                                onClick={this.loadWorkspaceTree}
                                className="p-1 border-none bg-transparent text-[var(--ifm-color-emphasis-500)] hover:text-[var(--ifm-color-primary)] cursor-pointer flex items-center transition-colors"
                                title="刷新目录"
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                                </svg>
                            </button>
                        )}
                    </div>

                    {/* 目录树内容 */}
                    <div className="flex-1 overflow-y-auto p-3 thin-scrollbar">
                        {directoryHandle ? (
                            <div className="flex flex-col gap-1.5">
                                {/* 工作区头部卡片 */}
                                <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 mb-2 shrink-0">
                                    <div className="flex items-center gap-1.5 overflow-hidden">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                        <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 truncate" title={directoryHandle.name}>
                                            {directoryHandle.name}
                                        </span>
                                    </div>
                                    <button 
                                        onClick={this.handleDisconnectDirectory}
                                        className="p-1 border-none bg-transparent text-[var(--ifm-color-emphasis-500)] hover:text-rose-500 cursor-pointer flex items-center transition-colors"
                                        title="断开本地目录"
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <line x1="18" y1="6" x2="6" y2="18" />
                                            <line x1="6" y1="6" x2="18" y2="18" />
                                        </svg>
                                    </button>
                                </div>

                                {/* 目录树列表 */}
                                {workspaceFiles.length > 0 ? (
                                    workspaceFiles.map((file, i) => (
                                        <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--ifm-color-emphasis-200)] text-xs text-[var(--ifm-color-emphasis-700)] hover:text-[var(--ifm-font-color-base)] transition-all cursor-default">
                                            {file.kind === 'directory' ? (
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2">
                                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                                </svg>
                                            ) : (
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38BDF8" strokeWidth="2">
                                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                                    <polyline points="14 2 14 8 20 8" />
                                                </svg>
                                            )}
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
                                    未授权工作区<br/>AI 无法操纵本地代码
                                </span>
                                <button 
                                    onClick={this.handleConnectDirectory}
                                    className="mt-4 px-3 py-1.5 rounded-lg bg-[var(--ifm-color-primary)] text-white text-[11px] font-bold border-none hover:opacity-90 cursor-pointer shadow-lg flex items-center gap-1 transition-all"
                                >
                                    📂 授权连接目录
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. 右侧 AI 聊天面板（自适应明亮主题） */}
                <div className="flex-1 flex flex-col bg-[var(--ifm-background-color)]">
                    {/* 右侧 Header */}
                    <div className="flex items-center justify-between px-6 py-3.5 border-b border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-color-emphasis-100)] shrink-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[var(--ifm-font-color-base)] tracking-wide">👨‍💻 CodeAgent</span>
                            <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--ifm-color-primary-lightest)] text-[var(--ifm-color-primary)] border border-[var(--ifm-color-primary-light)] font-bold tracking-wider">WORKSPACE MODE</span>
                        </div>

                        <div className="flex items-center gap-2">
                            {hasRealMessages && (
                                <div className="flex items-center gap-1">
                                    <button 
                                        onClick={this.handleCopyDisplay}
                                        className="w-7 h-7 border-none rounded bg-transparent text-[var(--ifm-color-emphasis-600)] hover:text-[var(--ifm-color-emphasis-900)] hover:bg-[var(--ifm-color-emphasis-200)] cursor-pointer flex items-center justify-center transition-all"
                                        title="复制对话文本"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                        </svg>
                                    </button>
                                    <button 
                                        onClick={this.handleClearHistory}
                                        className="w-7 h-7 border-none rounded bg-transparent text-[var(--ifm-color-emphasis-600)] hover:text-rose-500 hover:bg-rose-500/5 cursor-pointer flex items-center justify-center transition-all"
                                        title="重置当前会话"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polyline points="3 6 5 6 21 6" />
                                            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                                        </svg>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 消息历史区 */}
                    <div className="flex-1 relative overflow-hidden">
                        {!hasRealMessages && (
                            <div className="absolute inset-0 flex items-center justify-center px-8 pointer-events-none z-[1]">
                                <div className="flex flex-col items-center gap-3 text-center max-w-md">
                                    <div className="w-12 h-12 rounded-xl bg-[var(--ifm-color-primary-lightest)] border border-[var(--ifm-color-primary-light)] flex items-center justify-center text-[var(--ifm-color-primary)] animate-[bounce_2s_infinite]">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                            <polyline points="16 18 22 12 16 6" />
                                            <polyline points="8 6 2 12 8 18" />
                                        </svg>
                                    </div>
                                    <h3 className="text-sm font-bold text-[var(--ifm-font-color-base)] tracking-widest m-0 uppercase">CodeAgent Terminal</h3>
                                    <p className="text-xs text-[var(--ifm-color-emphasis-600)] leading-relaxed m-0">{WELCOME_MESSAGE}</p>
                                </div>
                            </div>
                        )}
                        <div ref={this.messagesAreaRef} className="h-full overflow-y-auto p-6 flex flex-col gap-6 thin-scrollbar">
                            {!hasRealMessages && <div className="flex-1" />}
                            {this.renderMessages()}
                        </div>
                    </div>

                    {/* 输入控制区 */}
                    <div className="px-6 py-4 border-t border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-color-emphasis-100)] shrink-0">
                        <div className="flex items-end gap-3 bg-[var(--ifm-background-color)] border border-[var(--ifm-color-emphasis-200)] rounded-xl pl-4 pr-1.5 py-1.5 transition-colors focus-within:border-[var(--ifm-color-primary)] focus-within:shadow-[0_0_12px_rgba(var(--ifm-color-primary-rgb),0.05)]">
                            <textarea 
                                ref={this.inputRef}
                                className="flex-1 border-none bg-transparent text-[var(--ifm-font-color-base)] text-xs leading-normal py-2.5 resize-none outline-none font-mono placeholder-[var(--ifm-color-emphasis-500)] overflow-y-auto [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-thumb]:bg-[var(--ifm-color-emphasis-300)] [&::-webkit-scrollbar-thumb]:rounded"
                                value={inputValue}
                                onChange={this.handleInputChange}
                                onKeyDown={this.handleKeyDown}
                                placeholder="向 CodeAgent 提问，输入文件重构、改写指令..."
                                rows={1}
                                disabled={isLoading}
                            />
                            {isLoading ? (
                                <button 
                                    onClick={this.handleStop}
                                    className="w-8 h-8 rounded-lg border-none flex items-center justify-center cursor-pointer bg-[var(--ifm-color-emphasis-200)] text-[var(--ifm-color-emphasis-600)] hover:bg-[var(--ifm-color-emphasis-300)] transition-all shrink-0"
                                    title="停止生成"
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="6" y="6" width="12" height="12" rx="1.5" />
                                    </svg>
                                </button>
                            ) : (
                                <button 
                                    onClick={this.handleSend}
                                    disabled={!inputValue.trim()}
                                    className={`w-8 h-8 rounded-lg border-none flex items-center justify-center cursor-pointer transition-all shrink-0 ${
                                        inputValue.trim() 
                                            ? 'bg-[var(--ifm-color-primary)] text-white hover:opacity-90 shadow-md shadow-[var(--ifm-color-primary-light)]' 
                                            : 'bg-[var(--ifm-color-emphasis-200)] text-[var(--ifm-color-emphasis-400)] cursor-not-allowed'
                                    }`}
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <line x1="22" y1="2" x2="11" y2="13" />
                                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                                    </svg>
                                </button>
                            )}
                        </div>

                        {/* 模型选择面板 */}
                        <div className="flex items-center justify-between mt-3 text-[10px] text-[var(--ifm-color-emphasis-500)]">
                            <label className="flex items-center gap-1.5">
                                <span>MODEL SELECT:</span>
                                <select 
                                    className="h-6 rounded border border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-background-color)] px-2 text-[10px] text-[var(--ifm-font-color-base)] font-mono outline-none cursor-pointer focus:border-[var(--ifm-color-primary)]"
                                    value={model}
                                    onChange={this.handleModelChange}
                                    disabled={isLoading}
                                >
                                    {Object.entries(this.props.pluginOptions.providers || {}).map(([providerId, provider]) => (
                                        <optgroup key={providerId} label={providerId.toUpperCase()} className="font-mono">
                                            {Object.entries(provider.models || {}).map(([modelId, label]) => (
                                                <option key={`${providerId}:${modelId}`} value={modelId}>{String(label)}</option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </select>
                            </label>
                            <span>WARNING: AI 物理读写，请做好代码提交备份。</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

export default CodePanel;
