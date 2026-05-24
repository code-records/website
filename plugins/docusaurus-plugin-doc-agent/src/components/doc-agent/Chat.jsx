import React from 'react';
import { usePluginData } from '@docusaurus/useGlobalData';
import { initReadonlyClient } from './tools/api';
import ChatPanel from './ui/ChatPanel.jsx';

class DocAgentChatInner extends React.Component {
    state = {
        isOpen: false,
    };

    toggleChat = () => {
        this.setState((prev) => ({ isOpen: !prev.isOpen }));
    };

    render() {
        const { isOpen } = this.state;

        return (
            <div className="fixed bottom-0 right-0 z-[9999] font-sans">
                <div style={{ display: isOpen ? undefined : 'none' }}>
                    <ChatPanel
                        onClose={this.toggleChat}
                        isOpen={isOpen}
                        pluginOptions={this.props.pluginOptions}
                    />
                </div>

                {!isOpen && (
                    <button
                        className="fixed bottom-6 right-6 w-12 h-12 rounded-full border-none cursor-pointer z-[10001] flex items-center justify-center transition-all duration-300 bg-[var(--ifm-color-primary)] text-white shadow-lg hover:scale-105 hover:shadow-xl"
                        onClick={this.toggleChat}
                        aria-label="打开 AI 助手"
                        title="AI 助手"
                    >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2a8 8 0 0 0-8 8c0 2.8 1.5 5.2 3.7 6.6L6 22l4.5-2.3c.5.1 1 .3 1.5.3a8 8 0 0 0 0-16z" />
                            <circle cx="9" cy="10" r="1" fill="currentColor" />
                            <circle cx="15" cy="10" r="1" fill="currentColor" />
                            <path d="M9.5 13.5c.8.8 2.2 1.5 2.5 1.5s1.7-.7 2.5-1.5" />
                        </svg>
                    </button>
                )}
            </div>
        );
    }
}

function Chat() {
    const pluginOptions = usePluginData('docusaurus-plugin-doc-agent');
    React.useMemo(() => {
        if (pluginOptions) {
            initReadonlyClient(pluginOptions);
        }
    }, [pluginOptions]);

    if (!pluginOptions) {
        return null;
    }

    const routePath = pluginOptions.routePath;
    const pathname = typeof window !== 'undefined' ? window.location.pathname.replace(/\/$/, '') : '';
    const normalizedRoutePath = routePath.replace(/\/$/, '');
    if (pathname === normalizedRoutePath || pathname.endsWith(normalizedRoutePath)) {
        return null;
    }

    return <DocAgentChatInner pluginOptions={pluginOptions} />;
}

export default Chat;
