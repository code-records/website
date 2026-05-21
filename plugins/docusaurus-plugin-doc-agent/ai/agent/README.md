# Agent Core

这是一个通用 agent 内核。运行时只维护 `Message / Plan / Round / Action` class 对象图；JSON 只作为保存、导出、恢复时的快照格式。

## 文件结构

```text
agent/
├── Agent.ts              # 对外门面：配置、工具表、adapter 创建、loop 入口
├── adapter/              # 模型协议适配
├── chat/
│   ├── Chat.ts           # 会话容器，持有 Message[]
│   └── Message.ts        # 单条消息；assistant message 驱动一次 loop
├── context/              # provider history 压缩、token 估算、会话快照
├── core/
│   ├── loop.ts           # 模型/工具编排
│   ├── continueResponse.ts
│   ├── executeRoundTools.ts
│   └── finalizeRound.ts
├── prompt/
├── round/                # Plan / Round / Action 运行状态
└── tools/                # 可选通用工具
```

## 运行流

```text
Chat.send(content)
  -> 创建 user Message
  -> 创建 assistant Message
  -> assistant Message 创建 Plan，拿到 Plan.rounds 引用
  -> Agent.loop({ history: Message[], rounds, notify, tools })
  -> adapter.chat() 返回 { raw, actions, status }
  -> loop 把 actions 包成 Round 并写入 rounds
  -> tool 状态：loop 内部并发执行 tools[call.name].execute(call.input)
  -> loop 把 tool result 写回 action.call.result 和 provider history
  -> final 状态：loop 写入 final Round 后结束
  -> assistant Message 从 final Round 汇总 content
```

`notify()` 只是 onchange：loop 写入或更新 `rounds` 后通知 UI 重新读取 class 对象图，不携带业务事件，也不承担外部执行工具的控制流。

## 工具格式

```ts
const tool = {
    name: 'tool_name',
    description: 'What this tool does.',
    timeout: 30000,
    input_schema: {
        type: 'object',
        properties: {},
    },
    startText(input) {
        return '正在处理...';
    },
    endText(event, input) {
        return '';
    },
    async execute(input = {}) {
        return {
            result: 'text returned to the model',
            event: { type: 'optional_event' },
        };
    },
};
```

工具是纯函数入口：`execute(input)`。如果工具需要上下文，从闭包或工具配置里读取，不接收 `agent`。

## Adapter

Adapter 只做协议转换：

```ts
{
    chat(messages, toolDefs, system, signal?, onStreamAction?),
    stream(messages, system, signal),
    toApiMessages(history),
    createToolResultMsg(toolUseId, content),
    formatToolDefs(tools),
}
```

`chat()` 通过可选的 `onStreamAction` 回调支持接口模式和流模式，详见 [adapter/MODES.md](./adapter/MODES.md)。

adapter 可以读取 `Message / Plan / Round / Action` class，但不持有运行状态。provider 原始消息只存在 loop 的内部 history 里。

## 快照

`toJSON()` / `fromJSON()` 只服务于保存、导出、恢复、复制等边界。正常 UI 和 adapter 流转直接读 class 对象图。
