# Built-in Tools

本目录提供可选的通用工具。它们不会自动生效，具体 agent 需要显式传入 `tools` 数组。

## 工具格式

```js
import { defineTool } from './toolRegistry.js';

export const myTool = defineTool({
    name: 'my_tool',
    description: 'Describe when to use this tool.',
    input_schema: {
        type: 'object',
        properties: {},
    },
    async execute(input = {}) {
        return { result: 'tool result' };
    },
});
```

`execute(input)` 是唯一执行签名。

## 合并工具

```js
import { mergeTools } from './toolRegistry.js';
import { PLAN_TOOLS } from './planTools.js';
import { createWebSearchTool } from './webSearch.js';

const tools = mergeTools(
    businessTools,
    PLAN_TOOLS,
    [createWebSearchTool({ mode: 'proxy' })],
);

const agent = new Agent({ config, tools });
```

## 文件索引

| 文件 | 工具名 | 说明 |
|---|---|---|
| `toolRegistry.js` | - | `defineTool`、`createToolMap`、`mergeTools` |
| `toolTrace.js` | - | 从中立消息中读取工具调用历史 |
| `modeTool.js` | `switch_mode` | 可选模式切换工具，需外层显式注册 |
| `planTools.js` | `make_plan` / `update_plan` | 规划工具 |
| `spawnAgent.js` | `spawn_agent` | 子 agent 工具 |
| `webSearch.js` | `web_search` | 搜索工具 |

## Web Search

`createWebSearchTool()` 支持两种模式：

| 模式 | 行为 |
|---|---|
| `proxy` | 请求后端搜索接口，把结果作为 tool result 返回 |
| `model` | 返回一段搜索请求文本，让模型自行处理 |

```js
const webSearch = createWebSearchTool({
    mode: 'proxy',
    endpoint: '/agent/v1/search',
    maxResults: 5,
});
```

默认后端协议：

```text
GET /agent/v1/search?q=keyword&limit=5
```

返回值可以是数组，也可以是 `{ results }` 或 `{ items }`。

## Plan Tools

`PLAN_TOOLS` 包含：

- `make_plan`：记录步骤计划
- `update_plan`：更新步骤状态

它们只返回普通 tool event，不耦合 UI。

## Spawn Agent

```js
const spawnAgent = createSpawnAgentTool({
    createSubAgent() {
        return subAgent;
    },
});
```

子 agent 的具体实现由调用方提供。该工具只规定输入输出，不假设具体运行时。

## Mode Tool

`modeTool.js` 只提供一个普通工具工厂。core 不会自动注入，也不会在 loop 内切换工具集。

如果需要模式路由，请在外层编排层决定当前 prompt 和工具列表，再把确定后的工具传给 `Agent` 或 `loop`。
