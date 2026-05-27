# Tools

`tools/` 是 agent 的能力扩展层。

新增外部能力、内部判断、调度、压缩、搜索、文件访问等，优先做成工具，而不是改 `model` 或 `loop`。

```text
model
  -> ModelToolCall
  -> core/loop
  -> ToolManager
  -> ToolRunner
  -> Tool.run()
```

工具系统只认识公共 `ModelToolCall`、`ToolDefinition`、`ToolResult`。它不认识 OpenAI / Claude / Gemini 的请求格式。

## 职责

`tools/` 负责：

- 定义工具基类 `Tool`。
- 定义工具输入输出 JSON 类型。
- 定义 `ToolRunContext`、`ToolResult`、`ContextPatch`、`ToolEvent`。
- 管理工具注册、查找、定义导出和执行。
- 给工具注入 `askModel()` 能力。
- 提供内置工具和工具抽象基类。

`tools/` 不负责：

- 解析 provider stream。
- 维护主 loop 状态机。
- 直接修改长期 GUI/session 历史。
- 直接操作 OpenAI / Claude / Gemini 请求格式。
- 决定模型何时结束、续写或调用工具。

## 目录结构

```text
tool/Tool.ts
  工具基类、JSON 类型、ToolRunContext、ToolResult、ContextPatch。

tool/ToolManager.ts
  工具系统门面。core/loop 只直接面对它。

tool/ToolRegistry.ts
  工具注册表，只负责重复名称检查、查找和 definitions 导出。

tool/ToolRunner.ts
  工具执行控制器，负责 timeout、kill、串并行调度和 ask 注入。

*.ts
  内置工具或工具抽象，例如 CompressTool、ScheduleTool、FileTool。
```

`ToolManager` 组合 `ToolRegistry` 和 `ToolRunner`，避免 `core/loop` 直接装配工具系统细节。

## Tool 基类

所有工具继承：

```ts
abstract class Tool {
  name: string;
  description: string;
  prompt: ToolPromptSchema;

  run(input: ToolInput, context: ToolRunContext): Promise<ToolResult>;
}
```

工具只实现自己的业务逻辑：

```ts
protected abstract execute(input, context): Promise<ToolResult>
```

`Tool.run()` 负责状态切换：

```text
idle -> running -> done
idle -> running -> error
```

工具内部如果需要长时间执行，可以在关键节点调用 `checkPause()`，支持协作式暂停。

## ToolDefinition

工具对模型暴露的定义是公共结构：

```ts
interface ToolDefinition {
  name: string;
  description: string;
  prompt: ToolPromptSchema;
}
```

工具只描述“自己是什么、需要什么输入”。把它转成 OpenAI function、Claude tool、Gemini declaration，是 `model` 子类的职责。

## ToolRunContext

工具执行时收到：

```ts
interface ToolRunContext {
  context: readonly Message[];
  createUserContextMessage(content: string): Message;
  tools: ReadonlyMap<string, Tool>;
  runner?: ToolRunner;
  signal?: AbortSignal;
}
```

字段含义：

```text
context
  当前 run 的 Message[] 只读快照。工具不能原地修改。

createUserContextMessage
  创建公共 Message，用于 contextPatch。它不是 provider message 工厂。

tools
  当前工具集合的只读视图，调度工具可用它检查目标工具是否存在。

runner
  工具执行控制器。ScheduleTool 等调度类工具可用它继续运行其他工具。

signal
  本次工具执行的中断信号。
```

工具如果需要修改上下文，返回 `contextPatch`，不要直接改历史。

## ToolResult

工具返回：

```ts
interface ToolResult {
  result: string;
  contextPatch?: ContextPatch;
  events?: ToolEvent[];
}
```

`result` 是工具给模型和 UI 的主要结果文本。

`events` 用于 GUI、trace、父 agent 或调度工具观察副作用。

`contextPatch` 表示工具请求改写本次 run 的上下文列表。长期历史是否落盘由上层根据 `AgentEvent` 决定。

## ContextPatch

当前支持：

```text
append
  在当前 run 上下文后追加 Message[]。

replace
  用新的 Message[] 替换当前 run 上下文。

compact
  用压缩后的 Message[] 替换当前 run 上下文，并可带 summary。
```

`ContextPatch` 不是 provider message，也不是长期历史 patch。它只表达工具对“下一轮发送给模型的上下文”的请求。

## Ask Model

工具可以通过 `this.askModel()` 发起内部回问。

这不是外部临时 prompt API，而是工具链路的一部分：

```text
Tool.askModel()
  -> createAskFactory()
  -> model.complete({ messages: [], toolAsk, toolChoice: 'none' })
```

适合场景：

- 压缩工具需要模型总结上下文。
- 搜索工具需要模型整理查询或结果。
- 文件工具遇到歧义输入。
- 调度工具需要模型修正执行计划。

回问默认禁用工具调用，避免工具递归调用工具。

## ToolManager

`ToolManager` 是 core 面向工具系统的门面：

```text
definitions()
  导出模型可见的工具定义。

require(name)
  检查工具是否存在。

runCall(call)
  执行模型产出的 ModelToolCall。

setContext(messages)
  loop 应用 contextPatch 后更新本次 run 的上下文快照。
```

它还负责把 sub-agent 包装成运行时工具 `run_sub_agent`。

`ToolManager` 的存在意义是让 `loop` 保持纯编排，不直接知道 registry、runner、sub-agent 包装、ask 注入这些工具细节。

## ToolRegistry

`ToolRegistry` 只做注册表：

```text
register(tool)
get(name)
require(name)
definitions()
list()
asReadonlyMap()
```

它不执行工具，不处理 timeout，也不注入 ask。

## ToolRunner

`ToolRunner` 负责真实执行工具：

- 单个工具调用：`runCall(ModelToolCall)`
- 调度计划：`runPlan(ToolRunPlan)`
- 超时：`timeoutMs`
- 中断：`kill(runId)`
- 批量中断：`killAll()`
- 注入工具回问能力：`tool.setAsk(...)`

`ScheduleTool` 使用 `ToolRunner.runPlan()` 做串行/并行调度。

## 内置工具

```text
CompressTool.ts
  上下文压缩工具，返回 compact 类型 contextPatch。

PlanTool.ts
  计划工具，只产生计划事件，不接管执行。

ScheduleTool.ts
  调度工具，把串行/并行/超时策略交给 ToolRunner。

SubAgentTool.ts
  子 agent 工具，把 Agent.subAgents 暴露为模型可调用能力。

FileTool.ts
  文件工具抽象基类，不默认访问本地文件系统。

ModeTool.ts
  模式切换工具，只发 mode_switch 事件。

WebSearchTool.ts
  搜索工具，支持代理搜索或工具内部 askModel()。

toolTrace.ts
  从 HistoryJSON 中提取既有工具调用输入。
```

## FileTool

`FileTool` 不默认拥有文件系统权限。

业务 agent 需要继承它，并明确实现：

```ts
protected executeFileOperation(input, context): Promise<FileToolOutput>
```

文件根目录、权限、写入策略和路径规范都应该由业务层声明。

## 新增工具

新增工具时按这个顺序做：

```text
1. 继承 Tool。
2. 声明 name、description、prompt。
3. 实现 execute(input, context)。
4. 需要模型判断时使用 this.askModel()。
5. 需要修改下一轮上下文时返回 contextPatch。
6. 需要给 UI/trace 发副作用时返回 events。
7. 在 agent.tools 中注册实例。
```

工具应该保持 provider 无关。只要工具开始关心 OpenAI / Claude / Gemini 字段，就说明边界错了，应该把那段逻辑移到 `model` 子类。
