/**
 * Simple Toast Message Utility
 * Replaces antd's message API
 */

class MessageManager {
    constructor() {
        this.listeners = [];
    }

    subscribe(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    notify(type, content, duration = 3000) {
        this.listeners.forEach(callback => callback({ type, content, duration }));
    }

    success(content, duration) {
        this.notify('success', content, duration);
    }

    error(content, duration) {
        this.notify('error', content, duration);
    }

    info(content, duration) {
        this.notify('info', content, duration);
    }

    warning(content, duration) {
        this.notify('warning', content, duration);
    }
}

export const message = new MessageManager();
