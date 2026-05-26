# Context

## 核心原则

`Message / Plan / Round / Action` 是 agent 的公共状态源。

provider messages 是各模型接口自己的私有格式。

中间不再抽象一层公共的线性 tool JSON。

```text
Message[] / Plan / Round / Action
  -> OpenAI provider messages
  -> Claude provider messages
  -> Gemini provider messages
```

## 公共状态源

GUI / session 层保存完整回答：

```text
Chat
└── Message[]
    ├── user Message
    └── assistant Message
        └── Plan
            └── Round[]
                └── Action[]
```

这里可以记录一次回答的完整过程：

- 用户问题
- 助手最终回答
- thinking
- tool call
- tool result
- context patch
- tool event
- 错误信息

这些数据同时服务于：

- GUI 展示
- 回放
- 调试
- session 持久化
- 后续模型请求的输入来源

也就是说，完整上下文源头是 `Message[]`，不是额外的 `ContextMessage[]` 状态。

## 发送模型时再提炼

模型请求不应该无脑消费完整 `Message`。

发送模型前，需要根据场景从公共状态源中提炼 provider 请求数据。

默认历史规则：

- 历史 user message：保留用户问题
- 历史 assistant message：保留助手最终回答
- 历史 assistant 的 `Plan / Round / Action`：默认不带
- local message：默认不带
- 空消息：默认不带

当前回答正在执行时，可以读取当前 assistant message 的 `Round / Action`，把本次 tool call / tool result 转成 provider 需要的格式。

因此第 10 次提问时：

```text
历史部分 =
  前 9 次用户问题
  前 9 次助手最终回答
  第 10 次用户问题

本次执行部分 =
  第 10 次 assistant message 的当前 rounds/actions
```

第 11 次提问时，前 10 次的历史仍然只默认提炼问答结果，不会把前 10 次的全部 tool result / thinking / action 无脑塞给模型。

## Provider 边界

不同 provider 对工具调用链的表示不一样：

```text
OpenAI: function_call / function_call_output
Claude: tool_use / tool_result content block
Gemini: functionCall / functionResponse parts
```

因此这类结构不应该被抽象成公共 JSON，例如：

```ts
{ role: 'assistant', actions: [toolCall] }
{ role: 'tool', toolUseId, content }
```

这些线性消息应该由各个 model 子类在转换 provider 请求时自己生成。

公共层只定义稳定的运行态结构：

```text
Message / Plan / Round / Action
```

provider 子类负责：

```text
Message[] / current rounds/actions -> provider request
provider stream/response -> model events -> round/action updates
```

## 本次执行

一次回答可能包含多轮 model / tool 交互。

这些交互应该推进当前 assistant message 的 `Plan / Round / Action`。

概念上：

```text
loop 推进 Round
Round 记录本轮 model 输出和工具结果
provider 子类从 Message/Round/Action 提炼下一次模型请求
```

不要把 loop 内部维护的临时线性 context 当成新的长期状态源。

如果实现上短期仍需要一个临时 scratchpad，它也只能是当前回答的运行缓存，结束后不应该替代 `Message / Plan / Round / Action`。

## 工具操作上下文

这个设计不阻止工具操作上下文，但要区分工具操作的是哪一层：

1. 操作当前执行过程

   工具结果、工具事件、错误、context patch 应该记录到当前 assistant message 的 `Round / Action`。

2. 操作长期对话状态

   例如压缩、摘要、删除历史、插入系统记忆，应该通过明确的 context patch / history patch 表达，而不是偷偷改 provider messages。

3. 操作 provider 请求

   工具不应该直接操作 OpenAI / Claude / Gemini 的请求格式。

工具面对的应是公共状态或明确 patch：

```text
Message / Round / Action
ContextPatch / HistoryPatch
```

provider 请求仍然由 model 子类在最后一步生成。

## 当前实现状态

当前代码已经把 `Message / Plan / Round / Action` 作为模型请求的公共状态源。

`Context.ts` 是空文件，不写注释、不写类型、不写导出。

关于 Context 边界的说明只放在 markdown 文档里，避免 TS 文件看起来像一个可继续扩展的上下文模块。

它不承载公共线性消息，也不承载工具调用类型。

模型产出的工具调用意图类型放在 `model/Model.ts`：

```text
ModelToolCall = model 产生的工具调用意图
              = loop 执行工具的输入
              = Round/Action 持久化工具调用过程的数据
```

`loop` 不维护长期 context；它把同一份 `Message[]` 交给 model。GUI 在收到 `AgentEvent` 后更新当前 assistant message 的 rounds/actions，下一轮 model 请求会从这份状态中提炼 provider 请求。

工具返回的 `ContextPatch` 仍然作为本次运行内的 patch 应用；后续如果需要真正修改长期 GUI/session 历史，应引入更明确的 `HistoryPatch`。

目标是：

```text
GUI 看到的完整过程
和模型下一轮需要的执行事实
来自同一份公共状态源
```
