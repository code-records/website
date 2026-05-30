# Model

`model/` 是 provider 适配层。

它负责把 OpenAI / Claude / Gemini 等品牌接口统一成 agent 内部可消费的 `ModelEvent` 流：

```text
provider request/response/stream
  -> Model 子类解析
  -> ModelEvent
  -> core/loop
```

`model` 不执行工具，也不维护聊天历史。它只做一件事：把公共 `Message[]` 转成 provider 请求，并把 provider 返回转成公共事件。

## 职责

`model/` 负责：

- 定义模型层公共契约：`ModelRequest`、`ModelEvent`、`ModelResponse`。
- 定义模型产出的工具调用动作：`ModelToolCall`。
- 把 `Message / Flow / Round / Action` 提炼成 provider 私有请求格式。
- 把 provider stream chunk 或完整 response 转成统一 `ModelEvent`。
- 处理 provider 的 URL、headers、HTTP 请求、错误格式和工具定义格式。
- 判断模型输出状态：`final`、`tool`、`continue`。

`model/` 不负责：

- 执行工具。
- 维护 agent loop。
- 修改 GUI/session 历史。
- 定义一套公共 provider-neutral messages。
- 暴露外部临时 prompt API。

## 统一入口

`core/loop` 只依赖：

```ts
model.stream(request)
```

无论底层 provider 是否真的支持流式接口，子类都要对外表现成统一事件流：

```text
ModelEvent
  content
  action
  done
  error
```

`Model.complete()` 是便捷方法，默认消费 `stream()`，直到拿到 `done(response)`。标准 loop 不直接依赖它；当前主要给工具内部 `askModel()`、测试、批处理使用。

## ModelRequest

`ModelRequest` 接收公共状态源：

```ts
interface ModelRequest {
  messages: readonly Message[];
  toolAsk?: string;
  tools?: ToolDefinition[];
  system?: string;
  signal?: AbortSignal;
  toolChoice?: 'auto' | 'none' | { name: string };
}
```

字段含义：

```text
messages
  GUI/session 持有的公共状态快照。

toolAsk
  工具内部 askModel() 的一次性回问内容，不进入长期 Message[]。

tools
  当前可用工具定义。provider 子类负责转成自己的 tool/function 格式。

system
  agent instructions。

signal
  中断信号。

toolChoice
  工具选择策略。工具回问通常使用 none，避免递归工具调用。
```

`toolAsk` 不是“外部临时问答接口”。它只服务于：

```text
Tool.askModel()
  -> model.complete({ messages: [], toolAsk, toolChoice: 'none' })
```

## ModelEvent

模型输出被规范成四类事件：

```text
content
  模型生成给用户看的正文文本增量，进入当前 Round.text。

action
  模型生成的结构化动作，目前包括 thinking 和 tool。

done
  本轮模型输出结束，携带聚合后的 ModelResponse。

error
  provider 或解析错误。
```

`action.kind` 表示动作是新增还是更新：

```text
add
  新 action 出现。

update
  provider 后续 chunk 补全同一个 action，例如补全工具参数。
```

## ModelResponse

`done(response)` 里的 `status` 只给 loop 判断下一步：

```text
final
  模型已完成，本次 loop 结束。

tool
  模型请求工具，loop 执行 ModelToolCall。

continue
  模型输出被截断，或只产出“我将继续查看”这类过渡说明；loop 在本次 run 内追加明确续跑指令后再次调用 model。
```

`ModelResponse.content` 是本轮聚合文本。`ModelResponse.actions` 是本轮聚合动作，loop 会以它为最终准。

## ModelToolCall

`ModelToolCall` 是模型产出的工具调用意图：

```ts
interface ModelToolCall {
  id: string;
  name: string;
  input: JsonObject;
  result?: JsonValue;
}
```

它放在 `Model.ts`，因为来源是模型输出：

```text
provider response
  -> ModelToolCall
  -> ModelAction
  -> core/loop
  -> ToolManager / ToolRunner
  -> Round / Action
```

它不是工具基类，也不是 provider 私有结构。

## Provider Messages

基类只定义转换流程：

```ts
protected buildProviderMessages(messages, toolAsk?)
protected abstract expandMessageToProviderMessages(message)
protected abstract expandToolAskToProviderMessages(toolAsk)
```

分工是：

```text
Model 基类
  负责遍历 Message[]。
  负责追加 toolAsk。

Model 子类
  负责把单条公共 Message 展开成 provider 私有格式。
  负责把 toolAsk 包装成 provider user message。
```

一条公共 `Message` 允许展开成 `0..N` 条 provider message。原因是 assistant message 里可能包含：

```text
content
plan
  round
    action: thinking
    action: tool call
    action: tool result
    action: context patch
```

而 provider 往往需要线性结构：

```text
OpenAI
  function_call / function_call_output

Claude
  tool_use / tool_result

Gemini
  functionCall / functionResponse
```

不要在基类里定义这样的公共中间消息：

```ts
{ role: 'assistant', actions: [...] }
{ role: 'tool', toolUseId, content }
```

这些结构看似通用，实际每个 provider 的位置、字段、嵌套和顺序都不同。公共层只保存 `Message[]`，provider 子类负责最终展开。

## Provider I/O

基类要求子类实现：

```ts
protected abstract request(body, signal?)
protected abstract requestStream(body, signal?)
```

每个 provider 自己决定：

- 普通请求 URL。
- 流式请求 URL。
- headers。
- 鉴权方式。
- 错误 body 解析。
- 重试策略。
- 非流式响应如何模拟成 stream。

基类不提供通用 `buildUrl()` / `buildHeaders()`，因为同一个 provider 的普通请求和流式请求也可能不是同一个 endpoint。

## 工具定义

工具层导出公共 `ToolDefinition`：

```ts
interface ToolDefinition {
  name: string;
  description: string;
  prompt: JsonObject;
}
```

provider 子类负责把它转成自己的格式：

```text
OpenAI function
Claude tool
Gemini functionDeclaration
```

这一步不能放到 `tools`，因为工具不应该知道模型品牌接口。

## Provider 子类

当前子类：

```text
OpenAIModel.ts
  OpenAI Responses API 适配。

ClaudeModel.ts
  Anthropic Messages API 适配，并兼容 chat-completions 风格 endpoint。

GeminiModel.ts
  Gemini generateContent / streamGenerateContent 适配。
```

每个子类都要处理：

- provider request body。
- provider tool/function declarations。
- provider stream chunk。
- provider tool call/tool result 表示。
- provider error body。
- `ModelResponse.status` 映射。

## 新增 Provider

新增一个模型品牌时，按这个顺序做：

```text
1. 继承 Model。
2. 实现 stream()，对外只 yield ModelEvent。
3. 实现 request() 和 requestStream()。
4. 实现 expandMessageToProviderMessages()。
5. 实现 expandToolAskToProviderMessages()。
6. 实现工具定义格式转换。
7. 把 provider 工具调用解析成 ModelToolCall。
8. 把 provider 结束原因映射成 final / tool / continue。
9. 在 index.ts 导出。
```

## 文件说明

```text
Model.ts
  模型层公共契约、Model 基类、ModelToolCall。

OpenAIModel.ts
  OpenAI provider 适配。

ClaudeModel.ts
  Claude provider 适配。

GeminiModel.ts
  Gemini provider 适配。

index.ts
  model 层导出入口。
```
