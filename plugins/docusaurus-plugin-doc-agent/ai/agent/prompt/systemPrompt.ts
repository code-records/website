const DEFAULT_SYSTEM_PROMPT = `\
- 调用工具时，过程性自述用 <think>...</think> 包裹
- 不包裹的文字会直接展示给用户`;

export function buildSystemPrompt(system = ''): string {
    return system
        ? `${system}\n\n${DEFAULT_SYSTEM_PROMPT}`
        : DEFAULT_SYSTEM_PROMPT;
}
