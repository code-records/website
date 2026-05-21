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
    ModelOption,
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
    tools: ToolMap;

    constructor({
        config = {},
        tools,
    }: AgentOptions = {}) {
        this.config = config;
        this.tools = createToolMap(tools);
        setLogger(config.debug ?? false);
    }

    adapter(modelOption: ModelOption): Adapter {
        if (modelOption.adapterType === undefined || modelOption.model.length === 0) {
            throw new Error('Agent adapter requires modelOption.adapterType and modelOption.model');
        }

        const config: AdapterConfig = {
            endpoint: modelOption.endpoint,
            model: modelOption.model,
        };

        if (modelOption.adapterType === 'openai') return new OpenAIAdapter(config);
        if (modelOption.adapterType === 'anthropic') return new ClaudeAdapter(config);
        if (modelOption.adapterType === 'gemini') return new GeminiAdapter(config);

        throw new Error(`Unknown adapter type: ${modelOption.adapterType}`);
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

    async runOnce({ modelOption, system, messages, signal }: RunOnceOptions): Promise<Message> {
        const ai = Message.assistant();
        const history = (messages ?? []).map(message => Message.fromJSON(message));
        await ai.generate(this, this.adapter(modelOption), history, {
            system: system ?? this.config.systemPrompt ?? null,
            signal,
        });

        return ai;
    }

    log(event: string, data: LogData | null = null): void {
        logger(event, data);
    }
}
