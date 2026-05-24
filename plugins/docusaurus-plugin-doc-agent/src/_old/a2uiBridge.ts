import type { Message } from '../agent/chat';
import type { DocAgentConfig } from '../components/doc-agent/DocAgent';

export const A2UI_ENABLED = false;

const A2UI_PROMPT_MARKER = '<!-- docs-a2ui-runtime-prompt -->';

export interface A2UIBridge {
    readonly enabled: boolean;
    readonly promptText: string;
    readonly SurfaceComponent: unknown;
    processMessages(messages: Message[]): void;
    processDirect(messages: unknown[]): void;
    clear(): void;
    resetTracking(): void;
    getSurfacesForMessage(message: Message, owners: Map<string, Message>): unknown[];
    getBottomSurfaces(): unknown[];
    getSurfaceOwners(messages: Message[]): Map<string, Message>;
    getCreatedSurfaceIds(payload: unknown): string[];
    patchSystemPrompt(config: DocAgentConfig): void;
}

function getSurfacePlacement(surfaceId: string): 'bottom' | 'message' {
    if (surfaceId?.startsWith('bottom-')) return 'bottom';
    return 'message';
}

interface BridgeOptions {
    onChange: () => void;
    onAction: (message: unknown) => void;
    onError: (message: unknown) => void;
}

function createEnabledBridge(options: BridgeOptions): A2UIBridge {
    const {
        A2UIRuntime: RuntimeClass,
        A2UISurface: SurfaceComp,
        getA2UIPromptText,
        toA2UIMessageList,
    } = require('../../ai/a2ui/index.js');

    const promptText: string = getA2UIPromptText();

    const runtime = new RuntimeClass({
        onChange: options.onChange,
        onAction: options.onAction,
        onError: options.onError,
    });

    let processedA2UI = new WeakMap<object, number>();
    let processedA2UIPayloads = new WeakMap<object, number>();

    const bridge: A2UIBridge = {
        get enabled() { return true; },
        get promptText() { return promptText; },
        get SurfaceComponent() { return SurfaceComp; },

        processMessages(messages: Message[]) {
            for (const msg of messages) {
                const a2ui = (msg as any).a2ui;
                if (!a2ui) continue;

                const list: any[] = Array.isArray(a2ui) ? a2ui : [a2ui];
                const payloadKey = a2ui && typeof a2ui === 'object' ? a2ui : null;
                const processedCount = processedA2UI.get(msg) || (payloadKey ? processedA2UIPayloads.get(payloadKey) : 0) || 0;
                const pending = list.slice(processedCount);
                if (!pending.length) continue;

                runtime.process(pending);
                processedA2UI.set(msg, list.length);
                if (payloadKey) processedA2UIPayloads.set(payloadKey, list.length);
            }
        },

        processDirect(messages: any[]) {
            runtime.process(messages);
        },

        clear() {
            runtime.clear();
        },

        resetTracking() {
            processedA2UI = new WeakMap();
            processedA2UIPayloads = new WeakMap();
        },

        getCreatedSurfaceIds(payload: any): string[] {
            const messages = toA2UIMessageList(payload) || [];
            return messages
                .map((m: any) => m.createSurface?.surfaceId)
                .filter(Boolean);
        },

        getSurfaceOwners(messages: Message[]): Map<string, Message> {
            const owners = new Map<string, Message>();
            for (const message of messages) {
                if (!(message as any).a2ui) continue;
                for (const surfaceId of bridge.getCreatedSurfaceIds((message as any).a2ui)) {
                    owners.set(surfaceId, message);
                }
            }
            return owners;
        },

        getSurfacesForMessage(message: Message, owners: Map<string, Message>): any[] {
            return runtime.surfaces.filter((surface: any) =>
                getSurfacePlacement(surface.id) === 'message' &&
                owners.get(surface.id) === message
            );
        },

        getBottomSurfaces(): any[] {
            return runtime.surfaces.filter((surface: any) => getSurfacePlacement(surface.id) === 'bottom');
        },

        patchSystemPrompt(config: DocAgentConfig) {
            const systemPrompt = config.systemPrompt || '';
            if (systemPrompt.includes(A2UI_PROMPT_MARKER)) return;

            config.systemPrompt = [
                systemPrompt,
                A2UI_PROMPT_MARKER,
                promptText,
            ].filter(Boolean).join('\n\n');
        },
    };

    return bridge;
}

const NULL_BRIDGE: A2UIBridge = {
    get enabled() { return false; },
    get promptText() { return ''; },
    get SurfaceComponent() { return null; },
    processMessages() { },
    processDirect() { },
    clear() { },
    resetTracking() { },
    getCreatedSurfaceIds() { return []; },
    getSurfaceOwners() { return new Map(); },
    getSurfacesForMessage() { return []; },
    getBottomSurfaces() { return []; },
    patchSystemPrompt() { },
};

export function createA2UIBridge(options: BridgeOptions): A2UIBridge {
    if (!A2UI_ENABLED) return NULL_BRIDGE;
    return createEnabledBridge(options);
}
