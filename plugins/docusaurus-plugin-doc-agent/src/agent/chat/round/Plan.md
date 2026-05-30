# Plan 概念封存

`Plan` 暂时不再作为 Agent 执行结构继续演进。后续重构直接使用 `Flow` 作为顶层执行单元，不做 `Plan -> Flow` 的兼容层，也不保留 `sendPlans` 这类过渡入口。

## 最终结论

- 不要 `Plan` 这一层。
- 顶级结构直接是 `flows[]`。
- 普通聊天永远只创建一个 `Flow`。
- 只有编程类特殊任务流才会创建多个 `Flow`。
- `Flow.input` 替代原来的 `Plan.prompt`。
- `Flow.rounds` 替代原来的 `Plan.rounds`。
- `loop` 只执行当前 `Flow`，不再理解计划概念。

目标结构：

```ts
Message
  -> flows[]
      -> rounds[]
          -> actions[]
```

## Flow 职责

`Flow` 表示一次实际执行单元。

- `label`：给 UI 展示的执行标题。
- `input`：本次执行输入，会作为模型请求里的用户上下文。
- `rounds`：该执行单元内的模型和工具回合。
- `status`：该执行单元的运行状态。

`input` 不再叫 `prompt`，因为它不是系统提示词，也不是长期计划配置，而是本次 `Flow` 的真实输入。

## 普通聊天

普通聊天只产生一个 `Flow`，不会触发多 flow。

```ts
flows: [
  {
    label: '默认执行',
    input: userInput,
  },
]
```

普通聊天的用户内容仍然写入聊天历史。模型请求天然可以从真实 user message 读取上下文，不需要额外补计划、不需要伪造空消息。

## 特殊任务流

欢迎页按钮、SDK 接入、向导、模板等编程特殊任务，可以直接创建多个 `Flow`。

```ts
flows: [
  {
    label: '[1/7] 引入 SDK 到项目',
    input: '检查项目结构，并指导完成 SDK 引入。',
  },
  {
    label: '[2/7] 配置 SDK 参数',
    input: '根据项目配置文件补齐 SDK 初始化参数。',
  },
]
```

这类任务不需要把按钮动作写成用户聊天消息。它们创建 assistant message，并把多个 `Flow` 挂在 message 上，由 `Agent.run()` 顺序执行。

## Chat 入口

建议入口保持清晰：

```ts
chat.send(content)
// 普通聊天：创建 user message，并创建一个默认 Flow。

chat.runFlows(flows)
// 特殊任务流：不创建 user message，只创建带 flows 的 assistant message。
```

不再新增或保留面向业务使用的 `chat.sendPlans(plans)`。

## Agent 执行

`Agent.run()` 负责遍历当前 assistant message 上的 `flows`：

```ts
for (const flow of assistant.flows) {
  const messages = buildFlowMessages(input.messages, assistant, flow);
  await loop({ flow, messages, ... });
}
```

`buildFlowMessages` 的职责是为当前 flow 准备模型请求上下文：

- 如果本轮已经有真实 user message，直接使用聊天历史。
- 如果本轮没有 user message，则把 `flow.input` 作为临时 user context 放进本次 model messages。
- 临时 user context 只进入 model request，不写入 Chat history。

这个逻辑属于 `Agent.run()` 准备 loop 参数阶段，不放进 `loop`。

## 不做兼容

这次重构不要兼容旧 `Plan` 概念：

- 不保留 `Plan.prompt`。
- 不保留 `Plan.rounds`。
- 不保留 `sendPlans` 作为公开入口。
- 不做 `Plan` 到 `Flow` 的双模型兜底。
- 不引入无用的默认计划、空计划、临时计划分支。

旧结论“用户计划不写入聊天历史、模型请求缺用户消息时从计划补齐”只保留其思想：特殊任务流不污染聊天历史，缺少 user message 时用当前 `Flow.input` 补齐模型请求上下文。
