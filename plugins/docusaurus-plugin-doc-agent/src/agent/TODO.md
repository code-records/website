# Core Context 设计备忘

先不急着实现，先把 `Flow.input`、聊天历史、loop 上下文之间的边界想清楚。

## 当前目标

希望未来 `loop` 不再直接接收一组简单的 `messages`，而是接收一个更明确的上下文对象。

这个上下文对象负责把持久化的聊天结构投影成 loop/model 本轮真正需要看的结构化数据。

建议文件：

```txt
src/agent/core/Context.ts
```

建议核心类型名：

```ts
LoopContext
```

不要直接叫裸 `Context`，因为项目里已经有 tool context、context patch、压缩上下文等概念。`LoopContext` 的边界更清楚：它只服务于一次 loop 执行。

## 核心原则

`Flow.input` 是所有 Flow 的统一执行输入。

- 普通聊天：用户消息写入聊天历史，同时复制进默认 `Flow.input`。
- 命令式单 Flow：不写用户消息，直接创建一个 `Flow.input`。
- 命令式多 Flow：不写用户消息，直接创建多个 `Flow.input`。

但 `Flow.input` 不等于每次都原样追加进模型 messages。是否注入、如何注入，由 `LoopContext` 负责。

## 需要解决的问题

要保证“聊天历史 + Flow.input”的组合在三个场景下都安全：

1. 普通聊天不重复输入。
2. 命令式单 Flow 能把 `flow.input` 作为本轮 user context。
3. 命令式多 Flow 能按顺序投影，避免输入和输出错位。

错误的多 Flow 上下文：

```txt
user: flow2.input
assistant: flow1 的结果
```

正确的多 Flow 上下文：

```txt
user: flow1.input
assistant: flow1 的结果

user: flow2.input
assistant: flow2 当前 rounds
```

## 边界划分

建议职责：

```txt
Chat.history
  持久聊天历史，只决定是否落 user message。

Flow.input
  当前执行单元的统一输入。

LoopContext
  根据 Message[]、当前 assistant message、当前 Flow，投影出 loop/model 使用的临时结构化消息序列。

loop
  只执行当前 Flow 的多轮 Round，不理解多 Flow 投影规则。

Model
  只把结构化 Message / Flow / Round / Action 转成 OpenAI、Claude、Gemini 的 provider 格式。
```

不要让 Model 理解：

```txt
history + assistant + currentFlow
```

多 Flow 投影规则属于 core，不属于 provider。

## 可能的接口

```ts
const context = LoopContext.from({
  messages: input.messages,
  assistant: runAssistant,
  flow,
});

await loop({
  context,
  flow,
  system,
  model,
  tools,
});
```

loop 内部调用模型时：

```ts
model.stream({
  system,
  messages: context.modelMessages,
  tools,
  signal,
});
```

## LoopContext 可能承担的能力

```ts
class LoopContext {
  readonly flow: Flow;

  get modelMessages(): readonly Message[] {}

  appendUserInput(input: string): void {}
  applyPatch(patch: ContextPatch): void {}
  toToolContext(): ToolRunContext {}
}
```

未来可以统一处理：

- 普通聊天避免重复插入 `Flow.input`。
- 命令式单 Flow 注入 `Flow.input`。
- 命令式多 Flow 按 input/result 顺序展开。
- `continue` 时追加临时 user message。
- 工具返回 `contextPatch` 后更新 loop 上下文。
- 压缩上下文、截断历史、只保留尾部消息。

## 暂定结论

`core/Context.ts` 这个方向可以继续。

但真正要实现的不是一个泛泛的上下文容器，而是一个明确的 `LoopContext`：它负责“结构化上下文投影和运行期上下文变更”。

loop 使用 `LoopContext`，model 只消费 `LoopContext` 产出的结构化 `Message[]`。
