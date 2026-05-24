import React from 'react';
import { Chat } from '../../agent/chat';
import { createA2UIBridge } from '../a2uiBridge';
import { DocAgent } from '../DocAgent';
import { getDefaultDocAgentModelOption } from '../modelOptions';
import ChatMessage from './ChatMessage.jsx';
import SuggestMessage from './SuggestMessage.jsx';

const WELCOME_MESSAGE = '你好！我是 AI 助手，可以帮你查阅文档、解答接入问题。';

class ChatPanel extends React.Component {
    constructor(props) {
        super(props);
        const pluginOptions = props.pluginOptions;
        const initialModelOption = getDefaultDocAgentModelOption(pluginOptions);
        this.modelOptions = pluginOptions.modelOptions;
        this.state = {
            inputValue: '',
            model: initialModelOption?.model || '',
        };
        this.messagesAreaRef = React.createRef();
        this.inputRef = React.createRef();

        this.agent = DocAgent.instance;
        this.agent.configure(pluginOptions);

        this.a2ui = createA2UIBridge({
            onChange: () => {
                if (this.agent.config.debug) {
                    console.log('[DocsAgent a2ui surfaces]', this.a2ui.runtime?.surfaces);
                }
                this.forceUpdate();
            },
            onAction: this.handleA2UIAction,
            onError: this.handleA2UIError,
        });

        this.chat = new Chat({
            agent: this.agent,
            modelOption: initialModelOption,
            setAgentModel: (agent, modelOption) => agent.setModelOption(modelOption),
            onChange: () => {
                if (this.agent.config.debug) {
                    console.log('[DocsAgent messages: chat change]', this.chat.messages);
                }
                this.a2ui.processMessages(this.chat.messages);
                this.forceUpdate();
            },
        });

        this.a2ui.patchSystemPrompt(this.agent.config);

        this.suggestAbort = null;
    }

    componentDidMount() {
        if (this.isDrawerOpen()) {
            document.body.style.overflow = 'hidden';
            setTimeout(() => this.inputRef.current?.focus(), 300);
        }
        this.scrollToBottom();
        this.pushSuggestions();
        this._unlisten = this.listenRouteChange();
    }

    componentDidUpdate(prevProps) {
        if (this.chat.isSending || this.chat.messages.length > 0) {
            this.scrollToBottom();
        }
        if (!this.isPage() && !prevProps.isOpen && this.props.isOpen) {
            document.body.style.overflow = 'hidden';
            setTimeout(() => this.inputRef.current?.focus(), 300);
            this.scrollToBottom();
            this.pushSuggestions();
        } else if (!this.isPage() && prevProps.isOpen && !this.props.isOpen) {
            document.body.style.overflow = '';
        }
    }

    componentWillUnmount() {
        document.body.style.overflow = '';
        this.suggestAbort?.abort();
        this._unlisten?.();
    }

    pushSuggestions = async (force = false) => {
        if (!this.isVisible()) return;
        if (this.isLastMessageRunning()) return;

        const pathname = window.location.pathname;
        if (!force && this._lastSuggestedPathname === pathname) {
            return;
        }

        this.clearSuggestionsSurface();

        this.suggestAbort?.abort();
        const controller = new AbortController();
        const modelOption = this.chat.modelOption;
        this.suggestAbort = controller;
        const message = await this.agent.suggestQuestions({
            modelOption,
            a2uiPromptText: this.a2ui.promptText,
            pathname,
            routePath: this.props.pluginOptions.routePath,
            signal: controller.signal,
        });
        if (
            this.suggestAbort !== controller ||
            controller.signal.aborted ||
            this.chat.modelOption !== modelOption
        ) {
            return;
        }
        if (this.isLastMessageRunning()) return;

        if (message) {
            this._lastSuggestedPathname = pathname;
            const lastMsg = this.chat.messages[this.chat.messages.length - 1];
            if (lastMsg && lastMsg.custom === 'suggest') {
                this.chat.removeLastMessage();
            }
            this.chat.addMessage(message);
        }
    };

    clearSuggestionsSurface = () => {
        this.a2ui.processDirect([this.agent.suggestionsDeleteMessage]);
    };

    isLastMessageRunning = () => {
        const messages = this.chat.messages;
        const lastMsg = messages[messages.length - 1];
        return !!lastMsg?.streaming;
    };

    listenRouteChange = () => {
        return this.agent.bindRouteChange({
            getPathname: () => window.location.pathname,
            onChange: () => {
                this.pushSuggestions();
            },
        });
    };

    scrollToBottom = () => {
        const el = this.messagesAreaRef.current;
        if (!el) return;
        const prev = this._lastScrollHeight || 0;
        this._lastScrollHeight = el.scrollHeight;
        if (el.scrollHeight >= prev) {
            el.scrollTop = el.scrollHeight;
        }
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
        const option = this.modelOptions.find(item => item.model === model);
        if (!option) return;

        const cleared = this.chat.modelOption?.adapterType !== option.adapterType;
        if (!this.chat.setModelOption(option)) return;

        if (cleared) {
            this.a2ui.resetTracking();
            this.a2ui.clear();
        }

        this.setState({ model });
        if (cleared) this.pushSuggestions(true);
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
        this.a2ui.resetTracking();
        this.chat.clear();
        this.a2ui.clear();
        this.pushSuggestions(true);
    };

    handleA2UIAction = async (message) => {
        const action = message?.action;
        if (!action) return;

        const context = action.context || {};
        const targetUrl = context.url || context.path || context.href;
        if (targetUrl && ['navigate', 'navigate_doc', 'open_doc'].includes(action.name)) {
            window.location.href = String(targetUrl);
            return;
        }

        const content = JSON.stringify({
            kind: 'ui_action',
            action: {
                name: action.name,
                surfaceId: action.surfaceId,
                sourceComponentId: action.sourceComponentId,
                context,
            },
        }, null, 2);

        await this.chat.send(content);
    };

    handleA2UIError = async (message) => {
        if (!message?.error || this.chat.isSending) return;
        await this.chat.send(`UI render error: ${message.error.message}`);
    };

    isOnlySuggestionMessage = () => {
        return this.chat.messages.length === 1 && this.chat.messages[0]?.custom === 'suggest';
    };

    hasConversationMessages = () => {
        return this.chat.messages.some(message => message.custom !== 'suggest');
    };

    isPage = () => {
        return this.props.variant === 'page';
    };

    isVisible = () => {
        return this.isPage() || this.props.isOpen;
    };

    isDrawerOpen = () => {
        return !this.isPage() && this.props.isOpen;
    };

    renderMessage = (message, idx, { floatingSuggestion = false } = {}) => {
        if (message.custom === 'suggest') {
            return (
                <SuggestMessage
                    key={idx}
                    message={message}
                    onSelectSuggestion={this.handleSuggestionClick}
                    floating={floatingSuggestion}
                />
            );
        }

        return (
            <ChatMessage
                key={idx}
                message={message}
                isStreaming={message.streaming}
                onTogglePlan={message.streaming ? idx => this.chat.togglePlan(idx) : undefined}
            />
        );
    };

    renderMessages = ({ skipOnlySuggestion = false } = {}) => {
        const owners = this.a2ui.getSurfaceOwners(this.chat.messages);
        const A2UISurface = this.a2ui.SurfaceComponent;
        const items = [];

        this.chat.messages.forEach((message, idx) => {
            if (skipOnlySuggestion && idx === 0 && message.custom === 'suggest') return;

            const surfaces = this.a2ui.getSurfacesForMessage(message, owners);
            if (message.role === 'assistant' && surfaces.length) {
                for (const surface of surfaces) {
                    items.push(<A2UISurface key={`surface-${surface.id}`} surface={surface} />);
                }
            }

            items.push(this.renderMessage(message, idx));

            if (message.role !== 'assistant' && surfaces.length) {
                for (const surface of surfaces) {
                    items.push(<A2UISurface key={`surface-${surface.id}`} surface={surface} />);
                }
            }
        });

        for (const surface of this.a2ui.getBottomSurfaces()) {
            items.push(<A2UISurface key={`surface-${surface.id}`} surface={surface} />);
        }

        return items;
    };

    render() {
        const { onClose } = this.props;
        const { inputValue, model } = this.state;
        const isLoading = this.chat.isSending;
        const hasRealMessages = this.hasConversationMessages();
        const onlySuggestionMessage = this.isOnlySuggestionMessage();
        const floatingSuggestion = onlySuggestionMessage ? this.chat.messages[0] : null;

        return (
            <>
                {!this.isPage() && (
                    <div className="fixed inset-0 bg-black/25 z-[9999] animate-[fade-in_0.2s_ease-out]" onClick={onClose} />
                )}

                <div className={this.isPage()
                    ? 'ai-chat-panel h-full min-h-[calc(100vh-var(--ifm-navbar-height,56px))] flex flex-col text-[var(--ifm-font-color-base)] overflow-hidden'
                    : 'ai-chat-panel fixed z-[10000] top-0 right-0 w-1/2 min-w-[380px] h-screen flex flex-col border-l border-[var(--ifm-color-emphasis-200)] text-[var(--ifm-font-color-base)] overflow-hidden shadow-[-8px_0_32px_rgba(0,0,0,0.1)] animate-[slide-in-right_0.3s_ease-out]'
                }>
                    {/* 头部 */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-color-emphasis-100)] shrink-0">
                        <div className="flex items-center gap-2">
                            <span className="text-base font-semibold text-[var(--ifm-color-primary)]">AI</span>
                            <span className="text-sm font-semibold">助手</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--ifm-color-primary)] text-white font-medium">Beta</span>
                        </div>
                        <div className="flex items-center gap-0.5">
                            {hasRealMessages && (
                                <button
                                    className="flex items-center justify-center w-7 h-7 border-none rounded-md bg-transparent text-[var(--ifm-color-emphasis-600)] cursor-pointer transition-colors hover:bg-[var(--ifm-color-emphasis-200)] hover:text-[var(--ifm-color-emphasis-900)]"
                                    onClick={this.handleCopyDisplay}
                                    title="复制显示内容"
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                        <polyline points="14 2 14 8 20 8" />
                                        <line x1="16" y1="13" x2="8" y2="13" />
                                        <line x1="16" y1="17" x2="8" y2="17" />
                                    </svg>
                                </button>
                            )}
                            {hasRealMessages && (
                                <button
                                    className="flex items-center justify-center w-7 h-7 border-none rounded-md bg-transparent text-[var(--ifm-color-emphasis-600)] cursor-pointer transition-colors hover:bg-[var(--ifm-color-emphasis-200)] hover:text-[var(--ifm-color-emphasis-900)]"
                                    onClick={this.handleCopyChat}
                                    title="复制JSON数据"
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                    </svg>
                                </button>
                            )}
                            {hasRealMessages && (
                                <button
                                    className="flex items-center justify-center w-7 h-7 border-none rounded-md bg-transparent text-[var(--ifm-color-emphasis-600)] cursor-pointer transition-colors hover:bg-[var(--ifm-color-emphasis-200)] hover:text-[var(--ifm-color-emphasis-900)]"
                                    onClick={this.handleClearHistory}
                                    title="清空对话"
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                                        <path d="M10 11v6" /><path d="M14 11v6" />
                                    </svg>
                                </button>
                            )}
                            {!this.isPage() && (
                                <button
                                    className="flex items-center justify-center w-7 h-7 border-none rounded-md bg-transparent text-[var(--ifm-color-emphasis-600)] cursor-pointer transition-colors hover:bg-[var(--ifm-color-emphasis-200)] hover:text-[var(--ifm-color-emphasis-900)]"
                                    onClick={onClose}
                                    title="关闭"
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* 消息区域 */}
                    <div className="flex-1 relative overflow-hidden">
                        {!hasRealMessages && (
                            <div className="absolute inset-0 flex items-center justify-center px-6 pointer-events-none z-[1]">
                                <div className="flex flex-col items-center gap-3 text-center">
                                    <div className="w-12 h-12 rounded-full bg-[var(--ifm-color-primary)] flex items-center justify-center">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 2a8 8 0 0 0-8 8c0 2.8 1.5 5.2 3.7 6.6L6 22l4.5-2.3c.5.1 1 .3 1.5.3a8 8 0 0 0 0-16z" />
                                            <circle cx="9" cy="10" r="1" fill="white" />
                                            <circle cx="15" cy="10" r="1" fill="white" />
                                            <path d="M9.5 13.5c.8.8 2.2 1.5 2.5 1.5s1.7-.7 2.5-1.5" />
                                        </svg>
                                    </div>
                                    <h3 className="text-lg font-semibold text-[var(--ifm-font-color-base)] m-0">有什么可以帮你的？</h3>
                                    <p className="text-sm text-[var(--ifm-color-emphasis-600)] m-0">{WELCOME_MESSAGE}</p>
                                </div>
                            </div>
                        )}
                        <div ref={this.messagesAreaRef} className="h-full overflow-y-auto flex flex-col thin-scrollbar">
                            {!hasRealMessages && <div className="flex-1" />}
                            {this.renderMessages({ skipOnlySuggestion: onlySuggestionMessage })}
                        </div>
                        {floatingSuggestion && (
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2]">
                                <div className="pointer-events-auto">
                                    {this.renderMessage(floatingSuggestion, 0, { floatingSuggestion: true })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 输入区域 */}
                    <div className="px-4 pt-3 pb-3 border-t border-[var(--ifm-color-emphasis-200)] shrink-0">
                        <div className="flex items-end gap-2 bg-[var(--ifm-color-emphasis-100)] border border-[var(--ifm-color-emphasis-200)] rounded-xl pl-3.5 pr-1 py-1 transition-colors focus-within:border-[var(--ifm-color-primary)]">
                            <textarea
                                ref={this.inputRef}
                                className="flex-1 border-none bg-transparent text-[var(--ifm-font-color-base)] text-sm leading-normal py-2 resize-none outline-none font-[inherit] overflow-y-auto [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[var(--ifm-color-emphasis-300)] [&::-webkit-scrollbar-thumb]:rounded placeholder:text-[var(--ifm-color-emphasis-500)]"
                                value={inputValue}
                                onChange={this.handleInputChange}
                                onKeyDown={this.handleKeyDown}
                                placeholder="输入你的问题... (Enter 发送)"
                                rows={1}
                                disabled={isLoading}
                            />
                            {isLoading ? (
                                <button
                                    className="w-8 h-8 rounded-lg border-none flex items-center justify-center cursor-pointer shrink-0 bg-[var(--ifm-color-emphasis-200)] text-[var(--ifm-color-emphasis-600)] transition-all duration-200"
                                    onClick={this.handleStop}
                                    aria-label="停止"
                                    title="停止生成"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="6" y="6" width="12" height="12" rx="2" />
                                    </svg>
                                </button>
                            ) : (
                                <button
                                    className={`w-8 h-8 rounded-lg border-none flex items-center justify-center cursor-pointer shrink-0 transition-all duration-200 ${inputValue.trim()
                                        ? 'bg-[var(--ifm-color-primary)] text-white hover:opacity-90'
                                        : 'bg-[var(--ifm-color-emphasis-200)] text-[var(--ifm-color-emphasis-400)] cursor-not-allowed'
                                        }`}
                                    onClick={this.handleSend}
                                    disabled={!inputValue.trim()}
                                    aria-label="发送"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="22" y1="2" x2="11" y2="13" />
                                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                                    </svg>
                                </button>
                            )}
                        </div>
                        <div className="flex items-center justify-between gap-3 mt-2">
                            <label className="flex items-center gap-1.5 text-[11px] text-[var(--ifm-color-emphasis-600)]">
                                <span>模型</span>
                                <select
                                    className="h-6 max-w-[180px] rounded-md border border-[var(--ifm-color-emphasis-200)] bg-[var(--ifm-background-color)] px-1.5 text-[11px] text-[var(--ifm-font-color-base)] outline-none disabled:opacity-60"
                                    value={model}
                                    onChange={this.handleModelChange}
                                    disabled={isLoading}
                                    title="选择模型"
                                >
                                    {this.modelOptions.map(option => (
                                        <option key={option.model} value={option.model}>{option.label}</option>
                                    ))}
                                </select>
                            </label>
                            <div className="text-[11px] text-[var(--ifm-color-emphasis-500)]">
                                AI 基于文档内容回答，可能存在不准确之处
                            </div>
                        </div>
                    </div>
                </div>
            </>
        );
    }
}

export default ChatPanel;
