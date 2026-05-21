# Tools

`tools/` 是 agent 的主要扩展点。新增能力优先新增工具，而不是改 `model` 或 `loop`。

## 基类契约

所有工具继承 `Tool`：

```ts
abstract class Tool {
  name: string;
  description: string;
  input_schema: ToolInputSchema;

  run(input: ToolInput, context: ToolRunContext): Promise<ToolResult>;
}
```

工具执行时可以读取 `ToolRunContext.context`，但不能直接修改主上下文。需要修改时返回 `contextPatch`，由 loop 统一应用。

工具可以返回 `events` 暴露副作用状态，UI、trace、父 agent、调度工具都消费同一套事件。

## 自主回问模型

工具不是纯函数。工具遇到边界情况时，可以通过 `this.askModel()` 发起一轮局部模型询问，例如：

- 压缩工具不确定如何保留上下文重点。
- 文件工具遇到输入歧义或权限边界。
- 调度工具遇到超出边界的执行计划，需要让模型重新判断。

这类询问不污染主上下文，也不会因为主对话上下文结构不适合 provider 而失败。

## 内置基类和工具

| 文件 | 作用 |
|---|---|
| `Tool.ts` | 工具基类、强类型 JSON、`ToolRunContext`、`contextPatch`、工具事件 |
| `ToolRegistry.ts` | 工具注册表，负责重复名称检查和模型工具定义导出 |
| `CompressTool.ts` | 上下文压缩工具，返回 `compact` 类型 `contextPatch` |
| `PlanTool.ts` | 计划工具，只发事件，不接管执行 |
| `ScheduleTool.ts` | 调度工具，把串行/并行/超时策略交给 `ToolRunner` 执行 |
| `SubAgentTool.ts` | 子 agent 工具，把 `Agent.subAgents` 暴露为模型可调用能力 |
| `FileTool.ts` | 文件工具抽象基类，具体读写权限由业务 agent 实现 |
| `ModeTool.ts` | 可选模式切换工具，只发出 `mode_switch` 事件 |
| `WebSearchTool.ts` | 可选搜索工具，支持代理搜索或工具内部 `askModel()` |
| `toolTrace.ts` | 从 `HistoryJSON` 中提取既有工具调用输入 |

## ScheduleTool

`ScheduleTool` 的职责是让模型声明一个调度计划：

```json
{
  "mode": "parallel",
  "timeoutAction": "kill",
  "items": [
    { "name": "read_file", "input": { "path": "README.md" }, "timeoutMs": 5000 }
  ]
}
```

实际串行、并行、超时 Abort、运行记录由 `core/ToolRunner` 完成。

`timeoutAction = kill` 表示某个任务超时或被取消时，调度器会 Abort 还在运行的同批工具；`serial` 模式下后续未开始的工具会标记为 `skipped`。

`timeoutAction = continue` 表示当前工具记录为 `timeout`，但调度计划继续执行其他工具。

## FileTool

`FileTool` 只是抽象基类，不默认访问本地文件系统。具体 agent 应该继承它并实现：

```ts
protected executeFileOperation(input: FileToolInput, context: ToolRunContext): Promise<FileToolOutput>
```

这样文件根目录、权限、写入策略和路径规范都由业务层明确声明，避免基础架构默认拥有过大的文件权限。
