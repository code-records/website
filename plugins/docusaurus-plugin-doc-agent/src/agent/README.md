# Agent 架构设计与实现文档

Model  = 适配器
Tool   = 能力扩展点
loop   = 编排模型和工具的循环
Agent  = 对外入口和业务目的封装

`src/agent/` 是 AskSky 的 Agent 运行编排层。它将大语言模型（Model）、工具箱（Tools）、会话状态（Chat）与核心执行循环（core/loop）完美融合，封装为一个对外可声明、可继承、可灵活扩展的 AI 智能体单元。

---

## 备用名字
AskSky
NOIF

---

## 1. 架构总览与核心设计哲学

在大多数 Agent 框架中，状态管理和执行循环往往高度耦合，导致新模型适配繁琐、工具副作用难以控制、以及与前端 UI 状态不一致。AskSky 采用**分层自治、单状态源**的理念进行设计：

```mermaid
graph TD
    UI["前端 GUI / 调试器 / 日志"] <-->|订阅 AgentEvent / 提交 Message| Agent["Agent.ts (外部入口)"]
    Agent <-->|启动并驱动| Loop["core/loop (标准执行循环)"]
    Loop -->|统一 ModelRequest / ModelEvent| Model["model/Model (模型适配基类)"]
    Model --> OpenAI["OpenAIModel"]
    Model --> Claude["ClaudeModel"]
    Model --> Gemini["GeminiModel"]
    Loop <-->|编排调用| ToolManager["tools/ToolManager (工具门面)"]
    ToolManager <-->|生命周期/问答注入| ToolRunner["ToolRunner (执行控制器)"]
    ToolManager <-->|解析与注册| ToolRegistry["ToolRegistry (工具注册表)"]
    ToolRunner <-->|并发/协作式暂停| Tool["tools/Tool (工具基类)"]
    Tool -->|askModel() 独立决策通道| Model
```

### 核心设计哲学

1. **单状态源（Single Source of Truth）**
   * **不引入第二状态源**：没有公共的临时线性 `ContextMessage[]`。系统唯一的状态源就是 `Message / Plan / Round / Action`。
   * **按需提炼**：在向 Model 发送请求时，Model 适配器根据当前上下文（如历史轮次、当前正在执行的轮次）从 `Message[]` 树中提炼出 provider 特有的线性消息格式（如 OpenAI 的 `function_call`，Claude 的 `tool_use`）。
   * **保持一致**：GUI 看到的完整推理过程（Thinking、Tool Call、Tool Result）与下一轮模型请求需要的事实，均来自于同一份公共状态源，从而实现完美的状态同步与回放支持。

2. **能力即工具（Capability as Tool）**
   * 核心 `core/loop` 仅负责协调整体状态转换，不直接实现任何具体业务（如文件操作、网络检索、子 Agent 委派、甚至是上下文压缩）。
   * 所有能力全部封装为 `Tool`。新增能力 = 新增 `Tool`，无需修改 `loop` 或 `model`。

3. **工具自主回问决策（Tool Ask Model）**
   * 工具并非被动的纯函数。当遇到输入歧义、权限不足、上下文溢出等边界情况时，工具可通过内部的 `askModel()` 发起独立的单轮模型回问，这不会污染主会话上下文，也不会打乱主对话状态。

4. **子 Agent 即工具（Sub-Agent as Tool）**
   * 子 Agent 的编排和调用同样收敛在工具链中。`ToolManager` 会将子 Agent 包装成运行时工具 `run_sub_agent`。通过统一的事件流，父 Agent 可以透明地观察和管理整个委派执行过程。

---

## 2. 分层职责定义

| 层次/模块 | 物理路径 | 核心职责 | 典型接口与类 |
| :--- | :--- | :--- | :--- |
| **智能体入口** | `src/agent/` | **对外统一声明与边界封装**：声明 Agent 身份（`name`）、目标与提示词（`instructions`）、绑定工具箱（`tools`）与子智能体（`subAgents`）。提供流式 `run()` 与非流式 `complete()`。 | `Agent.ts` |
| **执行编排** | `src/agent/core/` | **无状态状态机**：消费 Model 事件，驱动 Tool 执行，协调 `Model ↔ Tool` 循环，并将状态变化打包成 `AgentEvent` 事件流向上透传。不维护长期历史。 | `loop.ts`, `helper.ts`, `CONTEXT.md` |
| **模型适配** | `src/agent/model/` | **模型生态解耦**：将不同厂商协议（OpenAI, Claude, Gemini）抽象为统一事件（`ModelEvent`）；负责从公共状态 `Message[]` 提炼 provider 专有请求；判定模型决策状态（继续、调用工具或结束）。 | `Model.ts`, `OpenAIModel.ts`, `ClaudeModel.ts`, `GeminiModel.ts` |
| **能力扩展** | `src/agent/tools/` | **沙箱工具箱与控制器**：暴露强类型的工具定义、执行逻辑；管理工具注册；由 `ToolRunner` 处理并发调度、超时控制、中断（Kill/Pause）与局部模型回问能力。 | `Tool.ts`, `ToolManager.ts`, `ToolRunner.ts`, `ToolRegistry.ts` |
| **会话历史** | `src/agent/chat/` | **公共状态树结构**：保存 GUI/Session 级别的长期聊天历史，支持 Plan、Round、Action 深度结构化数据，供前端渲染与模型再次提炼。 | `Message.ts`, `Chat.ts`, `History.ts`, `SessionStore.ts`, `round/` |
| **通用工具** | `src/agent/utils/` | **底层支持**：提供 Token 估算、JSON 安全解析、SSE 处理、错误封装与全链路日志 Trace。 | `errors.ts`, `trace.ts` |

---

## 3. 核心执行流程与事件机制

`Agent.run()` 启动后默认调用 `core/loop()`。每一轮交互的执行轨迹如下：

```text
               ┌────────────────┐
               │    loop 启动   │
               └───────┬────────┘
                       │
       ┌───────────────▼───────────────┐
       │   1. model.stream(messages)   │◄──────────────────────────┐
       └───────────────┬───────────────┘                           │
                       │ (Yields: thinking_delta / message_delta / action / done) │
       ┌───────────────▼───────────────┐                           │
       │   2. UI 消费事件并实时更新界面  │                           │
       └───────────────┬───────────────┘                           │
                       │                                           │
                       ├───────────────── ModelResponse.status ────┤
                       │                                           │
                       ├─────────────── final ─────────────────────┼───────────────┐
                       │                                           │ (Loop Finish) │
                       ├────────────── continue ───────────────────┤               │
                       │                                           │               │
                       │   (追加明确续跑指令，续写或继续调用工具)      │               │
                       │                                           │               │
                       └─────────────── tool ──────────────────────┘               │
                                       │                                           │
                       ┌───────────────▼───────────────┐                           │
                       │ 3. ToolManager 发送 tool_start │                           │
                       └───────────────┬───────────────┘                           │
                                       │                                           │
                       ┌───────────────▼───────────────┐                           │
                       │ 4. 并发调用 ToolRunner.run()   │                           │
                       └───────────────┬───────────────┘                           │
                                       │ (并发完毕，谁先完成就先处理)                  │
                       ┌───────────────▼───────────────┐                           │
                       │ 5. Yields: tool_done          │                           │
                       │    (含 contextPatch / events) │                           │
                       └───────────────┬───────────────┘                           │
                                       │                                           │
                       ┌───────────────▼───────────────┐                           │
                       │ 6. 应用 contextPatch 更新快照 │                           │
                       └───────────────┬───────────────┘                           │
                                       └───────────────────────────────────────────┘
                                                                                   │
                                                                           ┌───────▼────────┐
                                                                           │   Agent 结束   │
                                                                           └────────────────┘
```

### 3.1 统一事件流设计 (`AgentEvent`)
系统对外表现为全流式架构，在执行生命周期中会按需派发如下事件，供前端 UI 渲染、日志记录或副智能体观察：

* `agent_start` / `agent_done` / `agent_error`：Agent 的生命周期边界。
* `model_event`：透传模型的生成过程（文本 delta、正在思考、产生工具调用等）。
* `tool_start` / `tool_done` / `tool_event`：具体工具调用的执行状态与过程事件（例如搜索引擎的检索进度、文件写入事件）。
* `context_patch`：通知上下文发生了修改（例如触发了 Compact 上下文压缩）。
* `sub_agent_start` / `sub_agent_event` / `sub_agent_done`：委派给子智能体的完整子事件流。

---

## 4. 关键设计细节

### 4.1 深入“单状态源”设计 (`chat/round/`)
传统 Agent 通常仅将历史作为线性消息数组存储。而 AskSky 引入了高度结构化的**回复过程模型**：

* `Message`：消息单元。对于 Assistant 角色，除了回复文本外，还包含一个 `Plan`。
* `Plan`：计划模型。代表该回复内的多轮推理计划。
* `Round`：执行轮次。代表在该回复中，主循环驱动的一轮 `Model ↔ Tool` 交互。它记录这一轮的模型输出（文本、Thinking）和所触发Action。
* `Action`：推理动作。可以是 `thinking`（模型思考过程）、`tool`（工具调用意图及最终执行结果）。

这种树状结构确保了：
1. **历史与过程不分离**：模型调用的参数与对应的工具执行结果、中间思考、甚至是改写补丁（ContextPatch）都被完好地记录在同一个结构树下。
2. **极佳的 UI 表现力**：前端界面能够以极佳的微动画和折叠面板展示每一个工具的调用细节、耗时和返回。

### 4.2 上下文改写补丁 (`ContextPatch`)
工具如需改写下一轮发送给模型的上下文，需返回 `ContextPatch`。当前支持：
* `append`：在运行期上下文列表末尾追加新消息。
* `replace`：直接用一组新消息替换运行期上下文列表。
* `compact`：上下文压缩请求。合并并保留关键历史，使用简短摘要代替臃肿的历史文本，同时保留当前的正在运行上下文。

### 4.3 协作式暂停与恢复
`ToolRunner` 与 `Tool.run()` 支持中断信号（`AbortSignal`）。在大文件写入、并发检索等长耗时操作中，工具可在执行关键节点调用 `checkPause()`，实现协作式优雅暂停或安全终止，避免内存泄漏与不可预知的状态污染。

---

## 5. 内置扩展工具

本层在 `src/agent/tools/` 下提供了丰富的内置生产力工具：

| 内置工具文件 | 对模型暴露的名称 | 职责与特性 |
| :--- | :--- | :--- |
| `CompressTool.ts` | `compress_context` | 自动上下文压缩。在上下文接近 Token 阈值时触发，自主利用 `askModel()` 生成历史摘要，并返回 `compact` 类型的 `ContextPatch`。 |
| `WebSearchTool.ts` | `web_search` | 网络检索工具。支持返回检索进度事件，并可在检索数据庞大时内部启用 `askModel()` 提炼关键网页摘要后返回。 |
| `SubAgentTool.ts` | `run_sub_agent` | 子 Agent 路由工具。将父 Agent 的 `subAgents` 列表自动转换并对外暴露，使模型具备自主委派专门任务给子 Agent 的能力。 |
| `ScheduleTool.ts` | `schedule_tools` | 串并行工具调度器。模型如果需要并行执行多个工具或指定超时时间，可调用此工具由 `ToolRunner` 统筹。 |
| `FileTool.ts` | *(抽象基类)* | 文件读写接口定义。默认不直接访问本地文件，强制要求业务子类实现安全的根路径规范、沙箱隔离及冲突写入策略。 |
| `PlanTool.ts` | `update_plan` | 进度追踪与状态标记工具。只在执行生命周期中发出 `plan_update` 消息，不介入底层逻辑。 |
| `ModeTool.ts` | `switch_mode` | 运行时交互模式切换（如进入深度搜索、极速回答或代码诊断模式）。 |

---

## 6. 开发扩展指南

### 6.1 新增大语言模型适配（Model Provider）
当需要接入 DeepSeek、MiniMax 等新模型接口时：
1. **新建适配文件**：在 `src/agent/model/` 创建 `NewModel.ts` 继承自抽象基类 `Model`。
2. **实现事件流**：实现 `stream()` 方法，将新模型的流式/非流式响应实时封装为统一的 `ModelEvent`（尤其是多 Tool Call、Thinking 的 Delta 增量解析）。
3. **实现 Provider 请求映射**：
   * 实现 `expandMessageToProviderMessages()`：将公共结构化的 `Message / Plan / Round / Action` 提炼映射为新模型需要的线性 Messages JSON 数组。
   * 实现 `expandToolAskToProviderMessages()`：映射工具内部回问（Tool Ask）的消息格式。
4. **工具描述转换**：将 `ToolDefinition` 映射为对应模型所要求的 JSON Schema（例如把 prompt 格式化为 OpenAI/Gemini 特定的 parameters 字段）。
5. **结束标志映射**：在新模型响应结束时，将其结束状态（Finish Reason）安全映射为标准状态 `final`、`tool` 或 `continue`。
6. **导出**：在 `src/agent/model/index.ts` 中导出。

### 6.2 新增外部能力工具（Tool Extension）
当需要为 Agent 提供新技能（如代码执行沙箱、数据库访问、API 触发）时：
1. **新建工具文件**：在 `src/agent/tools/` 创建 `MyTool.ts` 继承自 `Tool`。
2. **定义元数据**：声明 `name`、清晰的 `description`、以及严谨的 `prompt`（包括每个字段的 description，这对 LLM 正确调用至关重要）。
3. **实现主逻辑**：实现 `execute(input, context)`，主逻辑仅在 `Tool` 的沙箱环境中运行。
4. **合理应用高级特性**：
   * **需要模型决策**：如有歧义，使用 `this.askModel("提示词内容")` 发起独立局部决策。
   * **影响下一轮上下文**：如要将额外提示、数据写入上下文，返回 `contextPatch`。
   * **发送副作用状态**：需要让 UI 或日志实时感知执行深度时，往返回对象的 `events` 数组中推送 `ToolEvent`。
5. **绑定与注册**：在初始化具体 Agent 实例（如 `DocsAgent`）时，将其加入 `tools` 属性数组中。

---

## 7. 目录树形结构

```text
src/agent/
├── Agent.ts               # Agent 基类及外部核心 API 入口
├── index.ts               # Agent 统一导出网关
├── chat/                  # 会话历史与过程模型 (Single Source of Truth)
│   ├── Chat.ts            # 会话管理器
│   ├── History.ts         # 长期历史定义
│   ├── Message.ts         # 消息单元（挂载 Plan/Round 状态树）
│   ├── SessionStore.ts    # Session 持久化与反序列化
│   ├── index.ts           # chat 导出
│   └── round/             # 执行轮次与动作细分
│       ├── Action.ts      # 动作抽象 (thinking, tool...)
│       ├── Plan.ts        # 回复推理计划模型
│       └── Round.ts       # 执行轮次模型
├── core/                  # 执行引擎与状态机编排
│   ├── loop.ts            # 核心编排循环 (loop)
│   ├── helper.ts          # 辅助函数（事件拼接、Patch 应用、Ask 构建）
│   ├── CONTEXT.md         # 深入状态设计的思想白皮书
│   └── README.md          # 编排层开发规范
├── model/                 # 模型适配层 (Provider Adapters)
│   ├── Model.ts           # 模型适配抽象基类与事件契约
│   ├── OpenAIModel.ts     # OpenAI 适配
│   ├── ClaudeModel.ts     # Claude 适配
│   ├── GeminiModel.ts     # Gemini 适配
│   ├── index.ts           # model 导出
│   └── README.md          # 适配层开发指南
├── tools/                 # 能力工具箱 (Tools System)
│   ├── tool/              # 工具引擎底层支持
│   │   ├── Tool.ts        # 工具抽象基类与上下文/结果定义
│   │   ├── ToolManager.ts # core 面向工具系统的网关门面
│   │   ├── ToolRegistry.ts# 工具重复命名判定与定义注册表
│   │   └── ToolRunner.ts  # 执行调度、超时、协作暂停与 Ask 注入器
│   ├── CompressTool.ts    # 自动上下文压缩工具
│   ├── FileTool.ts        # 文件操作抽象基类
│   ├── ModeTool.ts        # 运行时交互模式切换工具
│   ├── PlanTool.ts        # 推理进度计划更新工具
│   ├── ScheduleTool.ts    # 串并行多工具高级调度器
│   ├── SubAgentTool.ts    # 子 Agent 包装调度工具
│   ├── WebSearchTool.ts   # 网页搜索与提炼工具
│   ├── toolTrace.ts       # 执行回溯追踪工具
│   ├── index.ts           # tools 导出
│   └── README.md          # 工具扩展开发规范
└── utils/                 # 全局辅助库
    ├── errors.ts          # 强类型异常与反序列化
    └── trace.ts           # 结构化日志追踪
```
