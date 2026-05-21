import type {
    Adapter,
    AdapterChatResponse,
    AdapterMessageList,
    ToolDefinitionList,
} from '../types';

export interface ModelProtocolRequest {
    messages: AdapterMessageList;
    system?: string;
    tools?: ToolDefinitionList;
}

export interface RunModelProtocolOptions {
    adapter: Adapter;
    signal: AbortSignal | null;
}

export interface ModelProtocolResult<TOutput> {
    content: string;
    error?: unknown;
    output: TOutput | null;
}

export abstract class ModelProtocol<TInput, TOutput> {
    abstract readonly name: string;

    abstract build(input: TInput, adapter: Adapter): ModelProtocolRequest;

    abstract parse(content: string, response: AdapterChatResponse): TOutput | null;

    async run(
        input: TInput,
        { adapter, signal }: RunModelProtocolOptions
    ): Promise<ModelProtocolResult<TOutput>> {
        try {
            const request = this.build(input, adapter);
            const response = await adapter.chat(
                request.messages,
                request.tools ?? [],
                request.system ?? '',
                signal ?? undefined
            );
            const content = getResponseContent(response);
            return {
                content,
                output: this.parse(content, response),
            };
        } catch (error) {
            return {
                content: '',
                error,
                output: null,
            };
        }
    }
}

export function getResponseContent(response: AdapterChatResponse): string {
    return response.actions
        .filter(action => action.type === 'content' && action.content)
        .map(action => action.content)
        .join('');
}
