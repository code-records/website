# Core

`core/` 是 agent 的运行编排层。

它不定义 provider 请求格式，也不保存一套独立的公共上下文结构。当前公共状态源是：

```text
Message[] -> Message.plan -> Round[] -> Action[]
```

`core` 做的事情是读取这份公共状态，驱动：

```text
model -> tool -> model -> ... -> final
```

## 职责

`core/` 负责：

- 接收本次运行的 `Message[]` 只读快照。
- 调用 `model.stream()`，消费统一的 `ModelEvent`。
- 把 `ModelEvent` 包装成 `AgentEvent` 透传给 GUI / 日志 / 父 agent。
- 根据 `ModelResponse.status` 判断继续、执行工具或结束。
- 执行工具调用，处理工具超时、取消、事件和结果。
- 把 sub-agent 包装成运行时工具，让委派仍然走工具链路。

`core/` 不负责：

- 维护长期聊天历史。
- 直接修改 GUI/session 持有的 `Message[]`。
- 定义 OpenAI / Claude / Gemini 的线性 messages。
- 保存一份 `ContextMessage[]` 作为第二状态源。
- 暴露绕过 loop 的外部临时问答 API。

## 数据边界

外部输入进入 loop 时是：

```ts
messages: readonly Message[]
```

这表示 `loop` 可以读取公共状态，但不应该原地修改外部历史。

实现上 `loop` 会复制一份本次运行列表：

```ts
let runMessages = [...options.messages];
```

这份列表只用于当前 run 内部，例如追加“继续”或应用工具 patch。长期状态仍然应该通过 `AgentEvent` 回到 GUI/session 层后，由上层更新 `Message / Plan / Round / Action`。

## Model 入口

`core` 只调用统一入口：

```text
model.stream(ModelRequest)
```

无论 provider 底层是真流式、SSE、普通 HTTP response，还是用非流式模拟流式，对 `core` 来说都必须表现为：

```text
ModelEvent
  content_delta
  action
  done
  error
```

provider 子类负责把公共状态提炼成自己的请求格式：

```text
Message[] / Round / Action
  -> OpenAI provider messages
  -> Claude provider messages
  -> Gemini provider messages
```

因此 `core` 不认识这类 provider 私有结构：

```ts
{ role: 'assistant', tool_calls: [...] }
{ role: 'tool', tool_call_id, content }
{ functionCall: ... }
{ functionResponse: ... }
```

## Loop 状态机

一轮 loop 等于一次 model 调用，以及可能跟随的一批工具执行。

```text
for round in maxRounds:
  model.stream()
    -> content_delta/action/error/done

  done.status = final
    -> 结束

  done.status = continue
    -> 当前 run 内追加“继续”
    -> 下一轮 model.stream()

  done.status = tool
    -> 执行本轮 tool calls
    -> 发出 tool_start/tool_done/tool_event/context_patch
    -> 下一轮 model.stream()
```

`loop` 自己只根据 `ModelAction.type === 'tool'` 提取工具调用。thinking、content 等展示状态由事件交给上层维护。

## ToolCall

`ToolCall` 是一次工具调用意图：

```ts
{
  id: string;
  name: string;
  input: JsonObject;
  result?: JsonValue;
}
```

它会跨层流动：

```text
model 产出 ToolCall
loop 执行 ToolCall
ToolRunner 消费 ToolCall
Round/Action 记录 ToolCall
SessionStore 反序列化 ToolCall
```

所以它不是 provider 消息，也不是工具基类，而是 agent 运行态数据。

## 工具执行

工具执行主路径在 `ToolRunner`。

`loop` 做的是：

- 从 model actions 中收集 `ToolCall`。
- 找到对应工具。
- 注入工具回问能力 `askModel()`。
- 发出 `tool_start`。
- 调用 `executeToolCall()`。
- 工具完成后发出 `tool_done` 和 `tool_event`。

`executeToolCall()` 现在放在 `helper.ts`，只是 loop 的薄包装：

```text
ToolCall + registry + model + context snapshot
  -> ToolRunner.runCall()
  -> ToolResult
```

## 工具回问

工具可以通过 `askModel()` 发起一次内部回问。

这条路不是外部临时问答 API，而是工具链路的一部分：

```text
Tool.askModel()
  -> createAskFactory()
  -> model.complete({ toolAsk, messages: [], toolChoice: 'none' })
```

`toolAsk` 的含义是：

- 只由工具发起。
- 只用于本次 model request。
- 不写入长期 `Message[]`。
- 禁用工具调用，避免递归工具回问。

如果未来有摘要、压缩、校验、路由等临时模型能力，优先把它们建成工具或 loop 策略，而不是开放一个绕过 agent loop 的外部 prompt API。

## ContextPatch

工具可以返回 `contextPatch`。

当前它仍然表示“本次 run 内对消息列表的 patch”：

```text
append
replace
compact
```

它不等于新的长期状态源。长期 GUI/session 历史应该由上层根据 `AgentEvent` 决定如何落盘。

后续如果要让工具稳定修改长期历史，应该引入更明确的 `HistoryPatch`，而不是把 provider messages 或临时 context 当成公共状态。

## Sub Agents

sub-agent 不在 loop 中成为特殊分支。

`core` 会把 sub-agent 包装成运行时工具：

```text
model
  -> run_sub_agent tool
  -> child Agent.run()
  -> tool result
  -> parent model next round
```

这样父 agent 可以用同一套事件流观察委派过程：

```text
tool_start
model_event
tool_done
tool_event
```

## 文件说明

```text
loop.ts
  标准 agent 状态机，驱动 model/tool/sub-agent。

helper.ts
  loop 的局部辅助函数，例如事件包装、工具回问、工具执行包装。

ToolRunner.ts
  工具执行控制器，负责 timeout、kill、串并行调度和 ask 注入。

ToolCall.ts
  工具调用意图的运行态类型。

Context.ts
  空文件。当前不定义公共 Context，避免出现第二状态源。

CONTEXT.md
  关于 Message / Plan / Round / Action 如何作为公共状态源的设计说明。
```
