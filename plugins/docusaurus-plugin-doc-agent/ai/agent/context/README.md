# Context — 上下文管理

## 设计说明

参考 Claude Code 的做法：**全量保留 + 模型规划压缩**。

Agent 内部维护完整的对话历史（`_history`），包含所有 user / assistant / tool_use / tool_result 消息。
每次 send 时将全量历史传给 core loop，不做任何硬编码裁剪。
core loop 在每轮模型调用前都会让 LLM 先分析是否需要压缩、应该压缩哪一个安全区间。
如果模型选择压缩，系统再调用 LLM 生成摘要替换该区间；如果模型选择不压缩，则保持原始历史。
当规划失败但 messages 已超过阈值时，系统回退到本地安全切点策略，避免上下文过长导致下一轮调用失败。

```
全量历史 → LLM 规划是否压缩 → 是 → 校验安全区间 → LLM 摘要替换 → 发给模型
                         → 否 → 直接发给模型
                         → 规划失败且超阈值 → 本地安全切点回退压缩
```

不使用硬编码的轮次截断或 token 预算裁剪。模型负责判断压缩策略，程序负责候选区间生成、安全校验和失败回退。

## 压缩机制（compaction/index.ts）

触发条件：每轮模型调用前都会执行压缩规划；`compactThreshold` 只作为 planner 的参考值和失败回退阈值。

执行流程：
1. 本地枚举安全候选区间（轮次边界，不拆分 tool_use / tool_result 对）
2. 将候选区间和消息目录发给 LLM planner，由模型选择 `none` 或某个候选区间
3. 程序校验 planner 返回的 JSON、rangeId、索引和安全边界
4. 将被选中区间的完整消息发给 LLM，生成摘要
5. 用 `[Previous conversation summary] + 摘要` 替换原始区间
6. 保留未被选中的消息原样不动

安全切割规则：
- 切割点必须在轮次边界上（role=user 的纯文本消息之前）
- 不能切在 assistant(tool_use) 和 user(tool_result) 之间
- 不能切在连续的 tool_result 中间
- 至少保留 `keepTail` 条消息不被压缩
- planner 只能从本地生成的候选区间里选择；非法结果会被丢弃

## 配置项

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `compactThreshold` | number | 12000 | planner 参考阈值；规划失败时超过该值会回退压缩 |
| `compactKeepTail` | number | 4 | 压缩时保护的最近消息条数 |
| `compactPrompt` | string | 内置英文 | 发给 LLM 的压缩指令 |

设置 `compactThreshold` 即启用模型规划压缩，不设置则全量传递（适用于对话轮次确定很少的场景）。

planner / summary prompt 位于 `context/compaction/protocol.ts`，并通过 `core/modelProtocol.ts` 的类式模型协议接口执行。

## Token 估算（tokenEstimator.js）

纯本地估算，不调用 API。用于判断是否需要触发压缩，精度要求不高（±20% 可接受）。

## 文件结构

```
context/
├── README.md          ← 本文档
├── compaction/
│   ├── index.ts       ← 模型规划压缩：shouldCompact + compactMessages
│   └── protocol.ts    ← 压缩 planner / summary 的模型协议
├── tokenEstimator.ts  ← Token 估算
└── sessionStore.ts    ← 会话持久化（可选）
```

## 与 Claude Code 的对比

| | Claude Code | 本项目 |
|---|---|---|
| 历史保留 | 全量（mutableMessages） | 全量（Agent._history） |
| 压缩触发 | token 超阈值 | 每轮先由 LLM 规划 |
| 压缩方式 | LLM 生成摘要 | LLM 规划区间 + LLM 生成摘要 |
| 硬编码裁剪 | 无 | 无 |
| 切割安全 | 按消息分组 | 按轮次边界（不拆 tool 对） |
