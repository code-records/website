# Core

`core/` 是 agent 的运行编排层。它负责把一次 `Agent.run()` 的生命周期完整串联起来：

```text
Message[] -> model.stream() -> tool -> model.stream() -> ... -> final
```

它是一个**纯粹的调度者**，而非状态仓库。它不拥有长期对话历史，不定义具体模型 Provider 的请求格式，也不在内存中保存一套独立的公共线性上下文结构。

---

## 1. 架构定位与分层

在整个系统的架构中，`core` 扮演着中枢调度的角色：

```text
chat
  └── 拥有 GUI/session 的 Message[] 长期历史与状态落盘。

core
  └── 读取本次 Message[] 快照，驱动 model/tool 状态机循环，持续向外发射 AgentEvent。

model
  └── 把 Message[] / Round / Action 统一的公共状态提炼成具体模型 Provider 的请求格式。

tools
  └── 执行模型请求中的 ModelToolCall，返回 ToolResult / ToolEvent / ContextPatch。
```

### 职责边界

| `core/` 负责的职责 | `core/` **不**负责的职责 |
| :--- | :--- |
| ✓ 接收本次运行的 `Message[]` 上下文快照 | ✗ 保存长期的聊天历史与 session 状态 |
| ✓ 调用 `model.stream()` 消费统一的 `ModelEvent` | ✗ 维护 GUI 展示层状态与数据落盘 |
| ✓ 把底层事件包装成 `AgentEvent` 并实时向外透传 | ✗ 定义 OpenAI / Claude / Gemini 的私有请求格式 |
| ✓ 根据模型返回的 `ModelResponse.status` 判断终止或续写 | ✗ 保存 `ContextMessage[]` 作为第二线性状态源 |
| ✓ 通过 `ToolManager` 调度并安全执行模型请求的工具调用 | ✗ 直接执行工具的内部具体业务逻辑 |
| ✓ 把 sub-agent 包装进工具链路，避免给 loop 增加特殊分支 | ✗ 暴露绕过标准状态机循环的外部临时 Prompt API |

---

## 2. 核心编排循环 (Loop)

### 2.1 运行入口

`loop()` 是标准 agent 状态机，其调用参数定义如下：

```typescript
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

> [!NOTE]
> 标准调用 `Agent.run()` 时，`messages` 必须以一个 active `Message.assistant()` 结尾。
> `Agent.run()` 负责把 `AgentEvent` 应用到这个当前 assistant 的 `content / plan`，`loop` 只负责编排和发出事件。
> 在 `loop` 内部，会对数组做一次浅拷贝：`let runMessages = [...options.messages];`
> 这次复制只保护列表结构，但不深拷贝里面的 `Message` 对象。后续 model round 会从同一个 assistant message 的 `Round / Action` 读取最新工具调用和工具结果。

### 2.2 状态机运行逻辑

一轮 `round` 等于一次模型调用，以及可能跟随的一批并发工具执行：

```text
for round in maxRounds:
  1. 调用 model.stream() 消费流式事件
     ├── content        -> 实时吐出正文内容
     ├── action         -> 捕获 thinking/tool 动作并合并
     └── done(status)   -> 本轮流式输出结束，获取终止状态

  2. 根据 status 决定分支：
     ├── status === 'final'
     │     └── [本次运行结束] ──> 直接 return 终止循环
     │
     ├── status === 'continue'
     │     └── [模型输出被截断或只产出过渡说明] ──> 在 runMessages 追加明确续跑指令 ──> 进入下一轮 round
     │
     └── status === 'tool'
           └── [触发工具调用] 
                 ├── 提取 ModelToolCall 动作
                 ├── 触发并并发执行 ToolManager.runCall()
                 ├── 持续 yield 事件：tool_start ──> tool_done ──> tool_event / context_patch
                 └── 全部工具执行完毕 ──> 进入下一轮 round
```

> [!IMPORTANT]
> `core` 状态机在模型输出的 actions 中，**只负责执行** `ModelAction.type === 'tool'` 的动作。对于 `thinking` 等非工具动作，仅作为展示/记录层状态透传给上层，不干涉其内容。

### 2.3 事件流 (AgentEvent)

为了保障层级解耦，`loop` 对外仅发射统一的 `AgentEvent` 异步生成器，上层（如 GUI、日志、父 agent、调度工具）应消费事件流，而不应该读取或修改 `core` 内部的变量：

*   `model_event`：模型层事件，透传包含 `content`、`action`、`done`、`error` 的底层状态。
*   `tool_start`：表示某个 `ModelToolCall` 已经开始调度并执行。
*   `tool_done`：工具执行完毕，返回 `ToolResult`，UI 可以此更新动作的完成状态。
*   `tool_event`：工具在执行过程中产生的额外副作用事件。
*   `context_patch`：工具请求改写本次 run 内部的上下文消息列表。

> [!TIP]
> 外层的 `Agent.run()` 会在这个事件流的头部和尾部再补充包裹 `agent_start`、`agent_done` 以及 `agent_error`，提供更宏观的生命周期观测。

---

## 3. 公共状态源与上下文设计 (Context)

这一节深入阐述 `core` 模块的核心设计理念 —— **为什么不引入独立的 `Context` 模块与第二状态源？**

### 3.1 核心原则

在多数 Agent 框架中，往往会在内存中抽象出一套公共的、线性的 tool 消息格式（如 `{ role: 'tool', content: ... }`），然后再将该格式翻译给各个模型接口。但在本架构中：

*   **`Message / Plan / Round / Action` 是 Agent 唯一的公共状态源**。
*   各个模型 Provider 的 messages 是其各自子类的**私有格式**。
*   **中间不再抽象一层公共的线性 tool JSON**。

```text
Message[] / Plan / Round / Action (唯一状态源)
  ├── ──> OpenAI provider messages (OpenAI 专属转换)
  ├── ──> Claude provider messages (Claude 专属转换)
  └── ──> Gemini provider messages (Gemini 专属转换)
```

### 3.2 公共状态源的树状结构

GUI / session 层负责保存和持久化完整的树状结构。一次回答的完整生命周期全部被记录在其中：

```text
Chat
└── Message[]
    ├── user Message (用户提问)
    └── assistant Message (助手回答)
        └── Plan
            └── Round[]
                └── Action[] (包含 thinking, tool call, tool result, context patch 等)
```

这套唯一的公共状态源同时服务于以下多重职责，确保了 **“GUI 看到的完整过程”** 与 **“模型下一轮需要的执行事实”** 来源于同一种数据：
1. GUI 展示与用户交互。
2. 历史回放与回滚调试。
3. Session 长期持久化与落盘。
4. 后续模型请求的输入来源。

### 3.3 提炼请求规则 (发送模型时的裁剪)

模型请求不应该也无须无脑消费树状结构下的完整历史动作细节。在发送给具体模型前，各 `Model` 子类需要根据当前场景，从公共状态源中**提炼**出干净的 Provider 请求消息。

#### 默认历史提炼规则：
*   **历史 user message**：保留用户最初的问题文本。
*   **历史 assistant message**：**仅保留助手最终呈现给用户的回答**，默认**不带**历史 assistant 内部产生过的具体 `Plan / Round / Action` 细节。
*   **Local message / 空消息**：默认过滤不带。
*   **当前执行中的 message**：如果当前正在执行，可以读取当前最新 assistant message 的 `Round / Action`，将本轮的 tool call / tool result 提炼并翻译为当前 Provider 需要的格式。

#### 提炼演进实例：
当用户进行**第 10 次提问**时，发送给模型的上下文将被提炼为：
```text
历史部分 (前9次) =
  [用户提问 1] ──> [最终回答 1]
  ...
  [用户提问 9] ──> [最终回答 9]

当前执行部分 (第10次) =
  [用户提问 10] ──> [第 10 次 assistant 正在执行的当前 rounds / actions 细节]
```
当用户进行**第 11 次提问**时，原先第 10 次内部繁琐的思维过程、工具调用细节都会被过滤掉，只保留最终回答：
```text
历史部分 (前10次) =
  [用户提问 1] ──> [最终回答 1]
  ...
  [用户提问 10] ──> [最终回答 10] (第10次执行细节已被全部提炼和裁减)

当前执行部分 (第11次) =
  [用户提问 11] ──> [第 11 次 assistant 正在执行的当前 rounds / actions 细节]
```
这种提炼机制能够保证**模型随着对话轮数的增加，其上下文窗口不会被历史工具执行的冗余细节撑爆**，同时又保证了当前轮次执行时拥有完整的动作链事实。

### 3.4 Provider 差异边界

不同模型 Provider 对多轮工具调用链（Multi-turn Tool Calling）的表示方式存在极大差异：
*   **OpenAI**：依靠 `tool_calls` 数组和对应的 `tool` 角色消息（携带 `tool_call_id`）。
*   **Claude**：在 `assistant` 消息中使用 `tool_use` 类型的 content block，在紧随其后的 `user` 消息中使用 `tool_result` 类型的 content block。
*   **Gemini**：在 `model` 消息中使用 `functionCall` 类型的 parts，在紧随其后的 `user` 消息中使用 `functionResponse` 类型的 parts。

由于这种差异是协议层级的，任何试图在公共层强行定义线性 tool JSON（例如 `{ role: 'tool', toolUseId, content }`）的做法都会导致抽象泄漏。
因此，这类线性结构**必须由各个 model 子类在转换 provider 请求时，在各自类内部自行生成**。公共层只定义并维护极其稳定的运行态树状结构 `Message / Plan / Round / Action`。

### 3.5 工具操作上下文的三层原则

虽然我们极力避免工具直接越权修改上下文，但设计上依然支持工具在受控范围内操作上下文。为了避免混乱，必须遵循以下三层原则：

1.  **操作当前执行过程**
    *   工具结果、工具事件、错误、以及运行态 patch 应该且只应该记录到当前 assistant message 的 `Round / Action` 中。
2.  **操作长期对话状态**
    *   如果工具要执行类似“压缩历史”、“摘要”、“删除历史”、“插入系统长期记忆”等影响长期会话的操作，必须通过明确的 `ContextPatch` / `HistoryPatch` 表达，并在上层应用，**严禁在工具内部偷偷修改底层的 provider messages 缓存**。
3.  **操作 Provider 请求**
    *   **绝对禁止**。工具不应该、也不可能感知到 OpenAI / Claude / Gemini 的请求细节，Provider 请求必须在最后一步由对应的 model 子类去生成。

---

## 4. 关键协作机制

### 4.1 ToolManager

工具执行的主路径全部收敛在 `ToolManager` 中：

```text
loop (循环器)
  ├── ──> definitions() 获取工具声明
  ├── ──> 传递给 model.stream(...tools) 告知模型可用工具
  └── ──> 收到 tool call 后，调用 ToolManager.runCall(ModelToolCall)
            ├── ToolRegistry.require() 校验工具存在性
            └── ToolRunner.runCall() 触发工具具体执行，返回 ToolResult
```
通过这种设计，`loop` 状态机无需直接理解工具注册、超时挂起、Kill 信号、或者内部回问（askModel）等具体业务细节，实现了完美的职责解耦。

### 4.2 Tool Ask (工具内部回问)

工具在执行过程中，可以通过 `askModel()` 向模型发起一次内部临时回问：
```text
Tool.askModel()
  └── createAskFactory()
        └── model.complete({ toolAsk, messages: [], toolChoice: 'none' })
```
该回问机制属于纯粹的工具内部辅助路径：
*   **仅由工具主动发起**。
*   **其生命周期仅对当前工具请求有效**。
*   **绝对不会写入长期的对话 `Message[]` 中**。
*   **默认强行禁用工具调用**，杜绝工具无限递归调用工具带来的死循环和费用超支。

> [!TIP]
> 未来如果需要引入类似“网页摘要”、“JSON 校验”、“意图路由”等临时模型能力，应优先将其设计为特定工具或 loop 级策略，而不是向外部暴露一个绕过 core 循环的公用 prompt 接口。

### 4.3 Sub Agents (子代理委派)

在 `core` 的设计中，子代理（Sub-agent）**不会在 `loop` 中成为特殊的分支代码**。
`ToolManager` 会在运行时将 sub-agent **包装为标准的工具**交付给状态机：

```text
model (模型)
  └── 做出决策，要求调用包装好的 run_sub_agent 工具
        └── 触发子代理运行：child Agent.run()
              └── 运行完毕，返回 tool result
                    └── parent model 收到结果，继续下一轮编排决策
```
父 agent 与子代理之间能够以同一套 `AgentEvent` 事件流的形式去实时观察、展示、甚至打断这一委派过程，使整个系统的多代理（Multi-agent）协作流程极为统一。

---

## 5. 开发指南与目录文件说明

### 5.1 新能力应当放哪里？

当你在开发新功能或解决 Bug 时，请对照下表决定你的代码归属：

| 你的开发目标 | 推荐的开发路径 |
| :--- | :--- |
| **接入新的模型接口 / Provider** | 在 `model/` 目录下，实现或继承 `Model` 基类及其对应子类。 |
| **增加新的外部能力（如文件读写、网页搜索）** | 在 `tools/` 目录下，实现一个新的 `Tool` 子类并注册。 |
| **优化或修改模型与工具之间的循环调度策略** | 修改 `core/loop.ts` 中的状态机驱动逻辑。 |
| **处理或展示聊天历史的树状结构** | 修改 `chat/` 目录下的 `Message`、`Plan`、`Round` 或 `Action` 结构。 |
| **通用的 Token 计算、SSE 解析、错误统一包装** | 归纳到 `utils/` 通用工具目录下。 |

### 5.2 目录内文件说明

*   `loop.ts`：标准 Agent 状态机驱动器，协调 model、tool 和 sub-agent 的并发流转。
*   `helper.ts`：`loop` 内部局部的辅助纯函数，主要用于事件包装、action 合并以及工具回问工厂。
*   `Context.ts`：**空文件**。为了防止开发人员在 TS 层面引入第二状态源或第二线性消息缓存，该文件故意留空不写任何代码。所有关于上下文流转的规则和核心设计理念（Message-driven）均已在本文档（README.md）中进行了终极定义与沉淀。
