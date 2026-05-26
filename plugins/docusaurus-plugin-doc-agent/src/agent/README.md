# Agent

`src/agent/` 是 AskSky 的 agent 运行层。它把模型、工具和循环编排组合成一个对外可调用、可继承的 AI 单元。

## 这层解决什么问题

`model`、`tools`、`core/loop` 本身只是内部协作结构：

```text
Model  = 怎么和 LLM provider 通信
Tool   = 模型可以调用的能力
loop   = 让 Model 和 Tool 来回协作的执行引擎
Agent  = 对外入口，把以上内容组装成“一个有目的的 AI”
```

调用方通常不直接调用 `loop()`，而是创建某个具体 agent：

```ts
class DocsAgent extends Agent {
    name = 'docs';
    instructions = '你负责基于项目文档回答问题。';
    tools = [new SearchDocsTool(), new FileTool()];
}

const agent = new DocsAgent({ model });
const messages = [Message.user('如何配置文档搜索？')];

for await (const event of agent.run({ messages })) {
    // UI / 日志 / 父 agent 消费事件
}
```

## Agent 的职责

- 声明这个 AI 的身份：`name`。
- 声明这个 AI 的目标和行为边界：`instructions`。
- 绑定这个 AI 可以使用的工具：`tools`。
- 绑定可选的子 agent：`subAgents`。
- 提供对外运行入口：`run()`。
- 提供非流式便捷入口：`complete()`。

`Agent.run()` 默认调用 `core/loop()`：

```text
Agent.run(input)
  -> loop({
       agentName: this.name,
       model: this.context.model,
       tools: this.tools,
       system: this.instructions,
       messages: input.messages
     })
  -> yield AgentEvent
```

因此子类通常只需要声明配置，不需要重写运行流程。只有需要特殊调度策略的 agent 才覆盖 `run()`。

## 设计理念

AskSky 的核心不是把能力写进 loop，而是让 loop 只负责驱动模型和工具协作。

```text
Model  = 适配器
Tool   = 能力扩展点
loop   = 编排模型和工具的循环
Agent  = 对外入口和业务目的封装
```

模型只做 provider 适配：把 OpenAI / Claude / Gemini 等不同协议转换成统一事件和消息格式。模型不持有业务状态，不直接实现文件、压缩、调度等能力。

工具是主要扩展点。以后新增能力，优先新增工具，而不是改 model 或 core loop。

```text
新增能力 = 新增 Tool
```

工具不是完全被动的纯函数。工具接口需要具备自主询问模型的能力：当工具遇到上下文溢出、边界不清、权限不足、输入歧义等情况时，可以临时发起一轮独立询问，让模型帮助判断下一步怎么处理。

这类子询问不污染主上下文，也不会因为主对话上下文结构不匹配而被 provider 拒绝。它是工具自己的局部决策通道。

工具执行时可以读取 loop 注入的运行上下文：

```text
ToolRunContext
  -> context: 当前 loop 上下文的只读快照
  -> tools: 当前工具表只读视图
  -> signal: 取消信号
```

工具如果需要修改上下文，不直接改 `context`，而是返回 `contextPatch`，由 loop 统一应用。这样压缩、裁剪、追加工具结果等副作用都有明确边界。

工具如果需要暴露副作用状态，不直接耦合 UI，而是返回 `events`，由 loop 转成 `AgentEvent` 给 UI、日志、父 agent 或调度工具消费。

典型工具：

| 工具 | 能力 | 特性 |
|------|------|------|
| 压缩工具 | 管理上下文 | 可改写上下文；遇到压缩边界不确定时，临时询问模型决定保留策略 |
| 文件工具 | 读写文件 | 有返回值；处理大文件时可暂停、恢复 |
| 调度工具 | 编排其他工具 | 可观察其他工具状态；决定并行或串行；超出边界时可询问模型再决策 |

因此 loop 不需要理解每一种业务能力。loop 只需要识别模型提出的工具调用，执行工具，把工具结果写回上下文，然后根据模型响应决定是否进入下一轮。

## 分层职责

```text
Agent.ts
  对外入口和业务目的封装

core/loop.ts
  标准执行流程：消费 ModelEvent，执行工具，决定是否开启下一轮

model/Model.ts
  provider 适配：把 OpenAI / Claude / Gemini 等返回统一成 ModelEvent

tools/Tool.ts
  工具基类：暴露工具定义、执行逻辑、暂停恢复和模型回问能力
```

## 运行形态

`run()` 返回事件流，适合 UI、日志、实时观察、取消和父 agent 调度：

```ts
for await (const event of agent.run({ messages })) {
    // event: AgentEvent
}
```

`complete()` 消费 `run()` 并只返回最终响应，适合测试、批处理和不需要中间过程的调用：

```ts
const response = await agent.complete({ messages });
```

## 目录结构

```text
agent/
├── Agent.ts        # 对外继承入口
├── core/           # loop 和运行规则
├── model/          # provider 适配
├── tools/          # 工具扩展点
├── chat/           # 会话/轮次相关草稿
└── utils/          # 通用工具
```

`chat/` 存放 UI/会话层数据，例如 `History`、`Message`、`SessionStore`。它也是后续模型请求的公共状态源；model 子类负责从 `Message / Plan / Round / Action` 提炼 provider 请求格式。

`tools/` 下的 `ScheduleTool`、`SubAgentTool`、`CompressTool`、`FileTool` 是后续扩展 agent 能力的主要落点。模型负责决定何时调用工具，工具负责把能力封装为强类型输入输出，core 负责执行边界。
