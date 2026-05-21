# Core

`core/` 负责 agent 抽象和标准 loop。它消费 `model/` 产出的统一事件，不关心底层 provider 是原生 stream 还是原生 chat/complete。

## 职责边界

- 定义可继承的 `Agent`。
- 编排 model、tools、sub-agents。
- 消费 `ModelEvent`，并转换成更高层的 `AgentEvent`。
- 根据模型响应决定执行工具、开启下一轮或结束。

## Loop 消费规则

loop 只认 `ModelEvent`。

```text
model.stream()
  -> content_delta / thinking_delta
  -> tool_call_done
  -> done(response)
```

当 `done(response)` 到达后，loop 根据 `response.status` 决定下一步：

```text
status = tool
  -> 执行工具
  -> 应用工具返回的 contextPatch
  -> 写入 tool result
  -> 开启下一轮

status = continue
  -> 保留当前上下文
  -> 开启下一轮

status = final
  -> 结束
```

## 运行形态

标准 agent 可以有两种运行形态：

```text
Agent.run()
  -> 返回 AgentEvent 流，适合 UI、日志、实时观察、取消和子 agent 调度

Agent.complete()
  -> 消费 Agent.run()，只返回最终结果，适合测试、批处理、工具内部子询问
```

无论是哪种形态，底层公共协议仍然是 AskSky 自己的事件流。

## 工具上下文

loop 执行工具时负责注入 `ToolRunContext`：

```text
ToolRunContext
  -> context: 当前 loop 上下文的只读快照
  -> tools: 当前工具表的只读视图
  -> runner: 工具执行控制器，供调度工具串行/并行运行其他工具
  -> signal: 取消信号
```

工具需要修改上下文时返回 `contextPatch`，由 loop 统一应用；工具需要暴露状态时返回 `events`，由 loop 转换成 `AgentEvent`。

## ToolRunner

`ToolRunner` 是 core 提供给工具层的执行控制器。它负责：

- 单个工具调用的超时控制。
- 调度工具声明的串行 / 并行执行。
- 给被调度工具继续注入 `askModel()` 能力。
- 通过 `AbortSignal` 做协作式 kill。
- 产出 `ToolRunRecord`，记录 `runId`、`status`、`error` 和工具结果。

`ScheduleTool` 不直接实现并发细节，只把模型给出的计划交给 `ToolRunner`。这样调度策略属于工具，执行边界仍然留在 core。

## Sub Agents

`Agent.subAgents` 会在 loop 内转换为一个运行时工具 `run_sub_agent`。模型需要委派任务时仍然走工具调用链路：

```text
model -> run_sub_agent tool -> child Agent.run() -> tool result -> parent loop next round
```

这样子 agent 不需要成为 loop 的特殊分支，父 agent 也能用同一套 `AgentEvent`、trace 和工具结果机制观察委派过程。
