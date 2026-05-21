import { toA2UIMessageList } from './A2UIRuntime.js';

export const A2UI_MIME_TYPE = 'application/json+a2ui';

export const A2UI_MESSAGE_SCHEMA = {
    type: 'object',
    description: 'A2UI v0.9 server-to-client message. The renderer validates payloads with the official @a2ui/web_core/v0_9 schemas before rendering.',
    oneOf: [
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                version: { const: 'v0.9' },
                createSurface: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                        surfaceId: { type: 'string' },
                        catalogId: { type: 'string' },
                        theme: { type: 'object', additionalProperties: true },
                        sendDataModel: { type: 'boolean' },
                    },
                    required: ['surfaceId', 'catalogId'],
                },
            },
            required: ['version', 'createSurface'],
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                version: { const: 'v0.9' },
                updateComponents: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        surfaceId: { type: 'string' },
                        components: {
                            type: 'array',
                            minItems: 1,
                            items: {
                                type: 'object',
                                additionalProperties: true,
                                properties: {
                                    id: { type: 'string' },
                                    component: { type: 'string' },
                                },
                                required: ['id', 'component'],
                            },
                        },
                    },
                    required: ['surfaceId', 'components'],
                },
            },
            required: ['version', 'updateComponents'],
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                version: { const: 'v0.9' },
                updateDataModel: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        surfaceId: { type: 'string' },
                        path: { type: 'string' },
                        value: {},
                    },
                    required: ['surfaceId'],
                },
            },
            required: ['version', 'updateDataModel'],
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                version: { const: 'v0.9' },
                deleteSurface: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        surfaceId: { type: 'string' },
                    },
                    required: ['surfaceId'],
                },
            },
            required: ['version', 'deleteSurface'],
        },
    ],
};

export const A2UI_TOOL_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        a2ui: {
            anyOf: [
                A2UI_MESSAGE_SCHEMA,
                {
                    type: 'array',
                    items: A2UI_MESSAGE_SCHEMA,
                },
                {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        messages: {
                            type: 'array',
                            items: A2UI_MESSAGE_SCHEMA,
                        },
                    },
                    required: ['messages'],
                },
            ],
            description: 'A2UI v0.9 server-to-client message, message array, or {messages:[...]} wrapper.',
        },
    },
    required: ['a2ui'],
};

export function parseA2UIPayload(payload) {
    return toA2UIMessageList(payload);
}

export function validateA2UIBasicCatalogMessages(messages) {
    const payload = parseA2UIPayload(messages);
    if (!payload) return 'Payload is not a valid A2UI v0.9 message, message array, or messages wrapper.';

    for (const message of payload) {
        const components = message.updateComponents?.components;
        if (!components) continue;

        const byId = new Map(components.map(component => [component.id, component]));
        for (const component of components) {
            if (component.component !== 'Button') continue;
            if (!component.child) {
                return `Button "${component.id}" must set "child" to a Text or Icon component id. Button does not render label/text/title fields.`;
            }

            const child = byId.get(component.child);
            if (!child) {
                return `Button "${component.id}" references missing child "${component.child}". Define a separate Text component for button text.`;
            }

            if (!['Text', 'Icon'].includes(child.component)) {
                return `Button "${component.id}" child "${component.child}" must be Text or Icon, got "${child.component}".`;
            }
        }
    }

    return null;
}

export function createA2UIDataPart(messages) {
    const payload = parseA2UIPayload(messages);
    if (!payload) return null;

    return {
        kind: 'data',
        data: payload,
        metadata: {
            mimeType: A2UI_MIME_TYPE,
        },
    };
}
