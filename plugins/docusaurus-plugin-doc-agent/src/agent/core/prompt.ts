export const THINK_CORE_PROMPT = `\
- 调用工具时，过程性自述用 <think>...</think> 包裹
- 不包裹的文字会直接展示给用户`;

export const TOOL_ERROR_CORE_PROMPT = `\
[TOOL ERROR] 工具调用失败。
错误详情: {{error}}
请根据此错误决定下一步的行动：
1. 检查并纠正参数（例如目录或文件路径不存在，可先使用 exists 或 list 查看工作区结构）；
2. 尝试换用其他适合的工具；
3. 如果确实无法自主解决，向用户说明原因并请求进一步指示。`;