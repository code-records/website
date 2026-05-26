# Core

`core/` 是 agent 的运行编排层。

它负责把一次 `Agent.run()` 串起来：

```text
Message[] -> model.stream() -> tool -> model.stream() -> ... -> final
```

它不拥有长期历史，不定义 provider 请求格式，也不保存一套独立的公共上下文结构。

当前公共状态源只有一份：

```text
Message[] -> Message.plan -> Round[] -> Action[]
```

## 分层位置

```text
chat
  拥有 GUI/session 的 Message[] 长期历史。

core
  读取本次 Message[]，驱动 model/tool 循环，发出 AgentEvent。

model
  把 Message[] / Round / Action 提炼成 provider 请求格式。

tools
  执行模型请求的 ModelToolCall，返回 ToolResult / ToolEvent / ContextPatch。
```

`core` 是调度者，不是状态仓库。

## 职责

`core/` 负责：

- 接收本次运行的 `Message[]`。
- 调用 `model.stream()`，消费统一的 `ModelEvent`。
- 把 `ModelEvent` 包装成 `AgentEvent`，透传给 GUI / 日志 / 父 agent。
- 根据 `ModelResponse.status` 判断结束、续写或执行工具。
- 通过 `ToolManager` 执行模型请求的工具调用。
- 把 sub-agent 包装进工具链路，而不是给 loop 增加特殊分支。

`core/` 不负责：

- 保存长期聊天历史。
- 原地维护 GUI/session 状态。
- 定义 OpenAI / Claude / Gemini 的 provider messages。
- 保存 `ContextMessage[]` 作为第二状态源。
- 直接执行工具业务逻辑。
- 暴露绕过 loop 的外部临时 prompt API。

## 运行入口

`loop()` 是标准 agent 状态机：

```ts
interface LoopOptions {
  agentName?: string;
  maxRounds?: number;
  messages: readonly Message[];
  model: Model;
  signal?: AbortSignal;
  subAgents?: Agent[];
  system: string;
  toolTimeoutMs?: number;
  tools: Tool[];
}
```

`messages` 是公共状态快照。实现里会复制数组：

```ts
let runMessages = [...options.messages];
```

这个复制只保护列表结构，不深拷贝 `Message` 对象。GUI/chat 层可以在收到 `AgentEvent` 后把事件应用到当前 assistant message 的 `plan`，后续 model round 再从同一批 `Message` 对象里读取更新后的 `Round / Action`。

## 一轮 Loop

一轮 `round` 等于一次模型调用，以及可能跟随的一批工具执行：

```text
for round in maxRounds:
  model.stream()
    -> content_delta
    -> action(thinking/tool)
    -> done(status)

  status = final
    -> 本次 run 结束

  status = continue
    -> 当前 run 内追加 Message.user('继续')
    -> 下一轮 model.stream()

  status = tool
    -> 提取 ModelToolCall
    -> ToolManager.runCall()
    -> 发出 tool_start / tool_done / tool_event
    -> 下一轮 model.stream()
```

`core` 只执行 `ModelAction.type === 'tool'` 的 action。`thinking` 和 `content_delta` 都是展示/记录状态，由事件交给上层维护。

## AgentEvent

`loop` 对外只发 `AgentEvent`：

```text
model_event
  模型层事件，包含 content_delta / action / done / error。

tool_start
  某个 ModelToolCall 开始执行。

tool_done
  工具返回 ToolResult。

tool_event
  工具产生额外副作用事件。

context_patch
  工具请求改写本次 run 的上下文列表。
```

`Agent.run()` 会在外层再补上：

```text
agent_start
agent_done
agent_error
```

GUI、日志、父 agent、调度工具都应该消费事件流，而不是读取 core 内部变量。

## Message 与 Context

现在没有公共 `ContextMessage` 类型。

原因是 GUI 真实需要展示和保存的是：

```text
assistant Message
  content
  plan
    round
      action: thinking
      action: tool call
      action: tool result
      action: context patch
```

而模型 provider 通常需要的是自己的线性结构：

```text
OpenAI function_call / function_call_output
Claude tool_use / tool_result
Gemini functionCall / functionResponse
```

这两者不应该在 `core` 里再抽象出第三套公共 JSON。公共状态就是 `Message[]`；provider 请求由 `model` 子类在调用前从 `Message[]` 提炼出来。

`Context.ts` 因此保持空文件。相关理念写在 `CONTEXT.md`，不要在 TS 里引入第二状态源。

## ContextPatch

工具可以返回 `contextPatch`：

```text
append
replace
compact
```

它表示工具请求修改“本次 run 继续发送给模型的上下文列表”。`loop` 会应用 patch，并发出 `context_patch` 事件。

它不等于长期历史写入协议。长期 GUI/session 历史是否落盘，应该由上层根据 `AgentEvent` 决定。

如果以后要让工具稳定修改长期历史，应该新增更明确的 `HistoryPatch`，不要把 provider messages 或临时 context 当成公共状态。

## ToolManager

工具执行主路径收敛到 `ToolManager`：

```text
loop
  -> ToolManager.definitions()
  -> model.stream(...tools)
  -> ToolManager.runCall(ModelToolCall)
     -> ToolRegistry.require()
     -> ToolRunner.runCall()
     -> ToolResult
```

`loop` 不直接装配 `ToolRegistry` / `ToolRunner`，也不理解工具调度、超时、kill、askModel 等细节。

## Tool Ask

工具可以通过 `askModel()` 发起一次内部回问：

```text
Tool.askModel()
  -> createAskFactory()
  -> model.complete({ toolAsk, messages: [], toolChoice: 'none' })
```

这条路径只属于工具系统：

- 只由工具发起。
- 只用于当前 request。
- 不写入长期 `Message[]`。
- 默认禁用工具调用，避免工具递归请求工具。

如果未来有摘要、压缩、校验、路由等临时模型能力，优先把它们建成工具或 loop 策略，而不是开放一个绕过 agent loop 的外部 prompt API。

## Sub Agents

sub-agent 不在 loop 中成为特殊分支。

`ToolManager` 会把 sub-agent 包装成运行时工具：

```text
model
  -> run_sub_agent tool
  -> child Agent.run()
  -> tool result
  -> parent model next round
```

父 agent 可以用同一套事件流观察委派过程。

## 新能力放哪里

```text
要接新模型接口
  放 model/，实现 Model 子类。

要接新外部能力
  放 tools/，实现 Tool 子类。

要改模型-工具循环策略
  改 core/loop.ts。

要记录或展示聊天历史
  放 chat/ 的 Message / Plan / Round / Action。

要估算 token、解析 JSON、处理 SSE、错误封装
  放 utils/。
```

## 文件说明

```text
loop.ts
  标准 agent 状态机，驱动 model/tool/sub-agent。

helper.ts
  loop 的局部辅助函数，例如事件包装、工具回问和 action 合并。

Context.ts
  空文件。当前不定义公共 Context，避免出现第二状态源。

CONTEXT.md
  关于 Message / Plan / Round / Action 如何作为公共状态源的设计说明。
```
