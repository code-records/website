import {
    A2uiClientMessageSchema,
    A2uiMessageSchema,
    A2uiMessageListSchema,
    A2uiMessageListWrapperSchema,
    MessageProcessor,
} from '@a2ui/web_core/v0_9';
import { A2UI_CATALOGS } from './A2UICatalog.js';

export function isA2UIPayload(payload) {
    return !!toA2UIMessageList(payload);
}

export function toA2UIMessageList(payload) {
    const message = A2uiMessageSchema.safeParse(payload);
    if (message.success) return [message.data];

    const list = A2uiMessageListSchema.safeParse(payload);
    if (list.success) return list.data;

    const wrapper = A2uiMessageListWrapperSchema.safeParse(payload);
    if (wrapper.success) return wrapper.data.messages;

    return null;
}

function getMessageSurfaceId(message) {
    return (
        message?.createSurface?.surfaceId ||
        message?.updateComponents?.surfaceId ||
        message?.updateDataModel?.surfaceId ||
        message?.deleteSurface?.surfaceId ||
        'unknown'
    );
}

function createClientErrorMessage(error, message) {
    const clientMessage = {
        version: 'v0.9',
        error: {
            code: 'A2UI_MESSAGE_REJECTED',
            surfaceId: getMessageSurfaceId(message),
            message: error?.message || 'A2UI message rejected by the renderer.',
        },
    };
    const parsed = A2uiClientMessageSchema.safeParse(clientMessage);
    return parsed.success ? parsed.data : clientMessage;
}

function skipDuplicateCreateSurfaceMessages(processor, messages) {
    const surfaceIds = new Set(processor.model.surfacesMap.keys());

    return messages.filter(message => {
        const surfaceId = message?.createSurface?.surfaceId;
        if (surfaceId) {
            if (surfaceIds.has(surfaceId)) return false;
            surfaceIds.add(surfaceId);
            return true;
        }

        const deletedSurfaceId = message?.deleteSurface?.surfaceId;
        if (deletedSurfaceId) surfaceIds.delete(deletedSurfaceId);

        return true;
    });
}

export class A2UIRuntime {
    constructor({ catalogs = A2UI_CATALOGS, onChange, onAction, onError } = {}) {
        this._catalogs = catalogs;
        this._onChange = onChange || null;
        this._onAction = onAction || null;
        this._onError = onError || null;
        this._processor = this._createProcessor();
    }

    _createProcessor() {
        const processor = new MessageProcessor(this._catalogs, action => {
            const clientMessage = {
                version: 'v0.9',
                action,
            };
            const parsed = A2uiClientMessageSchema.safeParse(clientMessage);
            this._onAction?.(
                parsed.success ? parsed.data : clientMessage,
                this.getClientMetadata(),
            );
        });

        processor.onSurfaceCreated(() => this._notify());
        processor.onSurfaceDeleted(() => this._notify());

        return processor;
    }

    process(payload) {
        if (!payload) return;
        const messages = toA2UIMessageList(payload);
        if (!messages) {
            this._rejectMessage(payload, new Error('A2UI payload must be a v0.9 message, message array, or {messages:[...]} wrapper.'));
            return;
        }
        this.processMessages(messages);
    }

    processMessages(messages) {
        const messageList = toA2UIMessageList(messages);
        if (!messageList) return;
        const nextMessages = skipDuplicateCreateSurfaceMessages(this._processor, messageList);
        if (!nextMessages.length) return;
        try {
            this._processor.processMessages(nextMessages);
        } catch (error) {
            this._rejectMessage(nextMessages, error);
        }
    }

    _rejectMessage(message, error) {
        console.warn('[A2UI] message rejected:', error, message);
        const rejectedMessage = Array.isArray(message) ? message[0] : message?.messages?.[0] || message;
        this._onError?.(
            createClientErrorMessage(error, rejectedMessage),
            this.getClientMetadata(),
            error,
            message,
        );
    }

    clear() {
        for (const id of Array.from(this._processor.model.surfacesMap.keys())) {
            this._processor.model.deleteSurface(id);
        }
        this._notify();
    }

    get surfaces() {
        return Array.from(this._processor.model.surfacesMap.values());
    }

    get processor() {
        return this._processor;
    }

    getClientCapabilities(options) {
        return this._processor.getClientCapabilities(options);
    }

    getClientDataModel() {
        return this._processor.getClientDataModel();
    }

    getClientSurfaceIds() {
        return Array.from(this._processor.model.surfacesMap.keys());
    }

    getClientMetadata() {
        const metadata = {
            a2uiClientCapabilities: this.getClientCapabilities(),
            a2uiClientSurfaceIds: this.getClientSurfaceIds(),
        };
        const dataModel = this.getClientDataModel();
        if (dataModel) metadata.a2uiClientDataModel = dataModel;
        return metadata;
    }

    _notify() {
        this._onChange?.();
    }
}
