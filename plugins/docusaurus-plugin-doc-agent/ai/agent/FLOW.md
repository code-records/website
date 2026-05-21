## Agent Loop Flow

正常运行时只使用 class 对象图：

```text
Chat
└── Message[]
    ├── user Message
    └── assistant Message
        └── Plan
            └── Round[]
                └── Action[]
```

`Message / Plan / Round / Action` 是唯一运行状态源。JSON 只作为保存、导出、恢复时的快照格式，不参与正常流转。

## 线性流程

```text
1. Chat 初始化
   Chat 内部保存 Message[]

2. 用户发送新问题
   Chat 追加 user Message
   Chat 创建 assistant Message

3. assistant Message.generate()
   创建新的 Plan
   Plan.status = active
   Plan.rounds = []

4. Agent.loop(options)
   system 在 Agent 层拼好
   tools 是运行时工具表
   history 是当前 Message[]，包含当前用户问题
   rounds 直接引用 assistant Message 当前 Plan.rounds
   notify 是 onchange，只触发 UI 重读

5. loop 初始化 provider state
   adapter.toApiMessages(history) -> provider messages
   adapter.formatToolDefs(Object.values(tools)) -> ToolDefinition[]

6. loop 调用模型
   adapter.chat(messages, toolDefs, system)
   adapter 返回 { raw, actions, status }

7. status = continue
   loop 写入 raw
   loop 追加 user("继续")
   loop 继续请求模型
   多次 continue 的 content 会合并成一个 Round

8. status = tool
   loop 把 actions 包成 Round
   loop push Round 到 rounds
   notify()
   loop 并发执行 tool actions
   tools[call.name].execute(call.input)
   loop 按 call.id 写回 action.call.result
   loop 把结果转成 provider tool result message
   每个工具完成后 notify()
   回到第 6 步

9. status = final
   loop finalizeRound(round)
   loop push final Round 到 rounds
   notify()
   loop 结束，不返回业务数据

10. assistant Message 收尾
    从 final Round 的 content action 汇总 assistant.content
    移除 final Round 里的 content action
    Plan.status = completed
    assistant.streaming = false
```

## 边界规则

- `Chat` 持有消息列表。
- `Message` 持有当前 Plan，并负责开始和结束一次生成。
- `Plan` 持有 Round[]，负责 active/completed/failed、折叠状态和快照。
- `loop` 是编排器，负责模型请求、工具执行、provider history，并写入当前 `rounds`。
- `adapter` 只读 class 对象图并转换 provider API 数据，不持有运行状态。
- `Action` 是状态数据，不执行工具。
- 工具是纯函数入口：`execute(input)`。
- UI 可以直接读取 class；状态变化后由 `notify()` 触发重读。
- `notify()` 不携带事件类型，也不承担外部执行工具的控制流。

## 不是纯状态机

当前 loop 不是纯状态机，它会直接调用模型、执行工具、维护 provider history，并写入 `rounds`。

纯状态机只接收当前 `state` 和 `event`，返回下一个 `state` 与 `effects` 描述；模型请求、工具执行、网络调用都在状态机外部执行，再把结果作为 event 喂回状态机。

## 接口模式与流模式

详见 [adapter/MODES.md](./adapter/MODES.md)。

