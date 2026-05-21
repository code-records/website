import React, { Component } from 'react';
import { message } from '../utils/message';

export default class ToastContainer extends Component {
    constructor(props) {
        super(props);
        this.state = {
            toasts: []
        };
    }

    componentDidMount() {
        this.unsubscribe = message.subscribe(this.addToast);
    }

    componentWillUnmount() {
        if (this.unsubscribe) this.unsubscribe();
    }

    addToast = ({ type, content, duration }) => {
        const id = Math.random().toString(36).substr(2, 9);
        const newToast = { id, type, content, duration, hiding: false };

        this.setState(state => ({
            toasts: [...state.toasts, newToast]
        }));

        setTimeout(() => this.removeToast(id), duration);
    };

    removeToast = (id) => {
        this.setState(state => ({
            toasts: state.toasts.map(t => t.id === id ? { ...t, hiding: true } : t)
        }));

        setTimeout(() => {
            this.setState(state => ({
                toasts: state.toasts.filter(t => t.id !== id)
            }));
        }, 300);
    };

    getIcon = (type) => {
        switch (type) {
            case 'success': return <i className="codicon codicon-pass-filled text-[#52c41a]" />;
            case 'error': return <i className="codicon codicon-error text-[#ff4d4f]" />;
            case 'warning': return <i className="codicon codicon-warning text-[#faad14]" />;
            default: return <i className="codicon codicon-info text-[#1890ff]" />;
        }
    };

    render() {
        return (
            <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[10000] flex flex-col gap-3 pointer-events-none">
                {this.state.toasts.map(toast => (
                    <div
                        key={toast.id}
                        className={`bg-white px-4 py-2.5 rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex items-center gap-2 text-sm text-[#1c1e21] pointer-events-auto ${toast.hiding ? 'animate-toast-out' : 'animate-toast-in'}`}
                    >
                        {this.getIcon(toast.type)}
                        <span>{toast.content}</span>
                    </div>
                ))}
            </div>
        );
    }
}
