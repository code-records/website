# Chat

`chat/` 是聊天场景适配层，只负责 UI/session/history/flow 编排。依赖方向固定为：

```text
chat -> agent/core
```

core 不依赖 chat。

聊天层展示结构：

```text
Message
  -> Flow[]
      -> result: AgentResult
          -> Round[]
              -> Action[]
```

`Flow` 是聊天/任务流层概念。Agent core 只产出一次运行的 `AgentResult`，Chat 把这个 `result` 挂回对应的 `Flow`。

## 边界

- `Chat.ts`：会话控制器，提供 `send()`、`stream()`、`runFlows()`。
- `History.ts`：长期聊天消息容器。
- `MessagesStorage.ts`：保存和读取 `HistoryJSON`。
- `Message.ts` / `Flow.ts`：只属于 chat/session/UI，不是 core 类型。

## 约定

- 普通聊天创建一个 user message 和一个 assistant message。
- 特殊任务流可以创建多个 `Flow`，挂在同一个 assistant message 上，由 Chat 顺序调用 `Agent.run()`。
- `Flow` 不保存 `rounds` 快照；运行轨迹只在 `Flow.result.rounds`。
- `chat` 不执行模型、不执行工具、不理解 provider 请求格式。
