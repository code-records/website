
/**
 * 思考流与过程性自述核心提示词（THINK_CORE_PROMPT）
 * 
 * 【架构决策说明与不同模型下的处理逻辑】
 * 
 * 1. 原生支持推理/思考流的模型（如 Claude 3.7 Sonnet, DeepSeek-R1, OpenAI o1/o3-mini）：
 *    - 这类模型在 API 响应流中天然包含了专门的思考推理文本字段（如 reasoning_text / thinking_delta）。
 *    - 各 Model 适配器（OpenAIModel / ClaudeModel）会自动解析并向外抛出 { type: 'action', action: { type: 'thinking' } } 事件。
 *    - 此时，大模型会由底层机制自主进行推理思考，本核心提示词属于可选或不需要状态，因为底层的原生提取不会污染正文。
 * 
 * 2. 不原生支持推理流的普通模型（如普通的 GPT-4o, Qwen-2.5, Kimi, GLM-4）：
 *    - 这类模型的所有输出都混杂在普通的 text content 里面。
 *    - 为避免中间产生的“过程自述 / 工具调用心路历程”直接呈现在聊天框正文从而污染用户视线，我们必须依靠本提示词引导模型：
 *      在执行工具前使用 <think>...</think> 标签主动包裹其过程自述。
 *    - 同时配合在 Agent.ts 运行时层的“流分流解析器”，在接收到流式 text 时拦截并剥离 <think>...</think> 文本段，
 *      动态包装为 'thinking' Action 派发给 UI 以渲染步骤进度，同时将正文清洗干净。
 */
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