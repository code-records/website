import { ClaudeAdapter } from './adapter/ClaudeAdapter';
import { GeminiAdapter } from './adapter/GeminiAdapter';
import { OpenAIAdapter } from './adapter/OpenAIAdapter';
import { Message } from './chat/Message';
import { loop } from './core/loop';
import { buildSystemPrompt } from './prompt/systemPrompt';
import { createToolMap } from './tools/toolRegistry';
import { setLogger, logger } from './utils/logger';
import type {
    AdapterConfig,
    Adapter,
    AgentConfig,
    AgentLoopOptions,
    AgentOptions,
    LogData,
    ProviderMap,
    ProviderConfig,
    RunOnceOptions,
    ToolMap,
} from './types';
import type { Round } from './round/Round';

interface AgentLoopInput {
    adapter: Adapter;
    compact: AgentLoopOptions['compact'];
    history: AgentLoopOptions['history'];
    notify: AgentLoopOptions['notify'];
    rounds: Round[];
    signal: AgentLoopOptions['signal'];
    system: string;
}

export class Agent {
    config: AgentConfig;
    providers: ProviderMap;
    tools: ToolMap;

    constructor({
        config = {},
        providers = {},
        tools,
    }: AgentOptions = {}) {
        this.config = config;
        this.providers = providers;
        this.tools = createToolMap(tools);
        setLogger(config.debug ?? false);
    }

    private getProviderByModel(model: string): ProviderConfig {
        for (const provider of Object.values(this.providers)) {
            if (Object.prototype.hasOwnProperty.call(provider.models, model)) return provider;
        }

        throw new Error(`Agent adapter requires a known model: ${model}`);
    }

    adapter(model: string): Adapter {
        const provider = this.getProviderByModel(model);

        const config: AdapterConfig = {
            model,
        };

        if (provider.adapter === 'openai') return new OpenAIAdapter(config);
        if (provider.adapter === 'anthropic') return new ClaudeAdapter(config);
        if (provider.adapter === 'gemini') return new GeminiAdapter(config);

        throw new Error(`Unknown adapter type: ${provider.adapter}`);
    }

    loop(options: AgentLoopInput): Promise<void> {
        const loopOptions: AgentLoopOptions = {
            maxRounds: this.config.maxRounds ?? Infinity,
            tools: this.tools,
            ...options,
            system: buildSystemPrompt(options.system),
        };
        return loop(loopOptions);
    }

    async runOnce({ model, system, messages, signal }: RunOnceOptions): Promise<Message> {
        const ai = Message.assistant();
        const history = (messages ?? []).map(message => Message.fromJSON(message));
        await ai.generate(this, this.adapter(model), history, {
            system: system ?? this.config.systemPrompt ?? null,
            signal,
        });

        return ai;
    }

    log(event: string, data: LogData | null = null): void {
        logger(event, data);
    }
}
