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
        /* 暂时注释掉动态从 AI 模型生成推荐问题的逻辑，以提升加载速度与稳定性
        const { directoryHandle, workspaceFiles } = this.state;
        if (directoryHandle && workspaceFiles.length > 0) {
            try {
                const files = workspaceFiles.slice(0, 20).map(f => `${f.name} [${f.kind}]`);
                const dynamicQuestions = await this.agent.suggestWorkspaceQuestions({
                    files
                });

                if (dynamicQuestions && dynamicQuestions.trim().length > 0) {
                    const suggestionsMsg = {
                        role: 'assistant',
                        local: true,
                        custom: 'suggest',
                        plan: {
                            rounds: [{
                                count: 1,
                                actions: [],
                                done: true,
                                status: 'final',
                                text: dynamicQuestions,
                            }],
                            status: 'completed',
                        },
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
        */

        const lastMsg = this.chat.messages[this.chat.messages.length - 1];
        if (lastMsg && lastMsg.custom === 'suggest') {
            this.chat.removeLastMessage();
        }

        const defaultSuggestions = [
            '依赖关系梳理',
            '检测代码问题',
            '给出改进建议',
        ].join('\n');

        this.chat.addMessage({
            role: 'assistant',
            local: true,
            custom: 'suggest',
            plan: {
                rounds: [{
                    count: 1,
                    actions: [],
                    done: true,
                    status: 'final',
                    text: defaultSuggestions,
                }],
                status: 'completed',
            },
        });
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
        this.setState({ model: this.agent.currentModelId });
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
        const { inputValue, model, directoryHandle, workspaceFiles } = this.state;
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
                        onInputChange={this.handleInputChange}
                        onKeyDown={this.handleKeyDown}
                        onSend={this.handleSend}
                        onStop={this.handleStop}
                        onModelChange={this.handleModelChange}
                    />
                </div>
            </div>
        );
    }
}

export default CodePanel;
