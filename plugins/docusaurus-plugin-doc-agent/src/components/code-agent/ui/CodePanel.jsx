import React from 'react';
import { Chat } from '../../../agent';
import { CodeAgent } from '../CodeAgent';
import {
    queryFileSystemDirectoryHandle,
    requestFileSystemDirectoryHandle,
    disposeFileSystemDirectoryHandle
} from '../../../agent/tools/browser/browserFileSystemHelper';
import CodeAssistantMessage from './CodeAssistantMessage.jsx';
import CodeBody from './CodeBody.jsx';
import CodeExplorer from './CodeExplorer.jsx';
import CodeHeader from './CodeHeader.jsx';
import CodeInput from './CodeInput.jsx';
import CodeUserMessage from './CodeUserMessage.jsx';
import SuggestMessage from './SuggestMessage.jsx';

const WELCOME_MESSAGE = '你好！我是 CodeAgent 极客编程助手。我已经搭载了物理文件读写工具，授权连接本地代码库后，我可以直接读取、诊断并物理重写你工作区下的代码，让我们开始吧！';

export class CodePanel extends React.Component {
    constructor(props) {
        super(props);
        this.agent = CodeAgent.instance;
        const defaultModel = this.agent.defaultModelId;
        this.agent.setCurrentModel(defaultModel);
        const currentModel = this.agent.currentModelId;

        this.state = {
            inputValue: '',
            model: currentModel,
            directoryHandle: null,
            workspaceFiles: [],
            suggestions: [],
            attachments: [],
        };
        this.messagesAreaRef = React.createRef();
        this.inputRef = React.createRef();

        this.chat = new Chat({
            agent: this.agent,
            model: currentModel,
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

    componentDidUpdate() {
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
            for await (const [name, handle] of directoryHandle.entries()) {
                items.push({ name, kind: handle.kind });
            }
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
        try {
            const text = await this.agent.suggestWorkspaceQuestions();
            if (!text) {
                this.setState({ suggestions: [] });
                return;
            }
            const items = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            this.setState({ suggestions: items });
        } catch (e) {
            console.warn('[CodeAgent] 推荐问题获取失败:', e);
            this.setState({ suggestions: [] });
        }
    };

    scrollToBottom = (force = false) => {
        this.messagesAreaRef.current?.scrollToBottom(force);
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
        this.setState({ model: this.agent.currentModelId });
    };

    handleSend = async () => {
        const { inputValue } = this.state;
        const question = inputValue.trim();
        if (!question || this.chat.isSending) return;

        if (this.inputRef.current) this.inputRef.current.style.height = 'auto';
        this.setState({ inputValue: '', suggestions: [] });

        this.scrollToBottom(true);
        await this.chat.send(question);
    };

    handleStop = () => {
        this.chat.stop();
    };

    handleSuggestionClick = async (question) => {
        if (!question || this.chat.isSending) return;
        this.setState({ suggestions: [] });
        this.scrollToBottom(true);
        await this.chat.send(question);
    };

    handleCopyDisplay = () => {
        const text = this.messagesAreaRef.current?.innerText;
        if (text) navigator.clipboard.writeText(text);
    };

    handleCopyStructured = () => {
        navigator.clipboard.writeText(JSON.stringify(this.chat.toJSON(), null, 2));
    };

    handleClearHistory = () => {
        this.chat.clear();
        this.pushSuggestions();
    };

    handleAddAttachment = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) {
                this.setState(prev => ({
                    attachments: [...prev.attachments, ...files],
                }));
            }
        };
        input.click();
    };

    handleRemoveAttachment = (idx) => {
        this.setState(prev => ({
            attachments: prev.attachments.filter((_, i) => i !== idx),
        }));
    };

    hasConversationMessages = () => {
        return this.chat.messages.some(message => message.custom !== 'suggest');
    };

    renderMessage = (message, idx) => {
        if (message.custom === 'suggest') return null;

        if (message.role === 'user') {
            return <CodeUserMessage key={idx} message={message} />;
        }

        return (
            <CodeAssistantMessage
                key={idx}
                message={message}
                isStreaming={message.streaming}
            />
        );
    };

    renderMessages = () => {
        return this.chat.messages.map((message, idx) => this.renderMessage(message, idx));
    };

    render() {
        const { inputValue, model, directoryHandle, workspaceFiles, suggestions, attachments } = this.state;
        const isLoading = this.chat.isSending;
        const hasRealMessages = this.hasConversationMessages();

        return (
            <div className="flex w-full h-screen bg-[var(--ifm-background-color)] text-[var(--ifm-font-color-base)] overflow-hidden font-mono antialiased selection:bg-cyan-500/20">
                <CodeExplorer
                    directoryHandle={directoryHandle}
                    workspaceFiles={workspaceFiles}
                    onRefresh={this.loadWorkspaceTree}
                    onConnectDirectory={this.handleConnectDirectory}
                    onDisconnectDirectory={this.handleDisconnectDirectory}
                />

                <div className="flex-1 flex flex-col bg-[var(--ifm-background-color)]">
                    <CodeHeader
                        onCopyDisplay={this.handleCopyDisplay}
                        onCopyStructured={this.handleCopyStructured}
                        onClearHistory={this.handleClearHistory}
                    />
                    <CodeBody
                        hasRealMessages={hasRealMessages}
                        messagesAreaRef={this.messagesAreaRef}
                        welcomeMessage={WELCOME_MESSAGE}
                    >
                        {this.renderMessages()}
                    </CodeBody>
                    <CodeInput
                        inputRef={this.inputRef}
                        inputValue={inputValue}
                        model={model}
                        modelOptions={this.agent.modelOptions}
                        isLoading={isLoading}
                        interactionSlot={
                            suggestions.length > 0 && (
                                <SuggestMessage
                                    suggestions={suggestions}
                                    onSelectSuggestion={this.handleSuggestionClick}
                                />
                            )
                        }
                        attachments={attachments}
                        onInputChange={this.handleInputChange}
                        onKeyDown={this.handleKeyDown}
                        onSend={this.handleSend}
                        onStop={this.handleStop}
                        onModelChange={this.handleModelChange}
                        onAddAttachment={this.handleAddAttachment}
                        onRemoveAttachment={this.handleRemoveAttachment}
                    />
                </div>
            </div>
        );
    }
}

export default CodePanel;
