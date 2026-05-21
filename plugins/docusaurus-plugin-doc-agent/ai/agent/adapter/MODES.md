# 接口模式与流模式

`adapter.chat()` 通过可选的 `onStreamAction` 回调支持两种使用模式，多轮循环由 loop 驱动，与模式选择无关。

## 接口模式（默认）

不传 `onStreamAction`，每轮 `chat()` 等完整结果返回后再继续。

```text
loop 第 1 轮  →  adapter.chat(messages, toolDefs, system, signal)
                  ↓ 内部解析 SSE，收集全部 actions
                  ↓ 返回 { actions, raw, status }
              →  loop 拿到 actions，包成 Round，执行工具
loop 第 2 轮  →  adapter.chat(...)
              →  ...
loop 第 N 轮  →  status = final，loop 结束
```

适用场景：不需要实时渲染的调用，如 `suggestQuestions`。

## 流模式

传入 `onStreamAction` 回调，`chat()` 在解析 SSE 过程中实时推送每个 action。

```text
loop 第 1 轮  →  adapter.chat(messages, toolDefs, system, signal, onStreamAction)
                  ↓ 解析 SSE，每产生一个 action 立即调用 onStreamAction(action, 'add' | 'update')
                  ↓ loop 中的 onStreamAction 写入 Round，触发 notify() → UI 增量渲染
                  ↓ 全部解析完毕，返回 { actions, raw, status }
              →  loop 执行工具
loop 第 2 轮  →  adapter.chat(..., onStreamAction)
              →  ...
```

适用场景：需要打字机效果的 agent 对话 UI。

## 协作关系

```text
                    ┌─────────────────────────────────────────┐
                    │  core/loop.ts                           │
                    │                                         │
                    │  定义 onStreamAction 回调（可选）          │
                    │    → kind='add'  → Round.addAction()    │
                    │    → kind='update' → Round.touch()      │
                    │  调用 adapter.chat(..., onStreamAction?) │
                    │  处理 status: tool / continue / final   │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │  adapter (OpenAI / Claude)              │
                    │                                         │
                    │  解析 SSE 流                             │
                    │  构建 Action 对象                        │
                    │  有 onStreamAction → 实时推送             │
                    │  无 onStreamAction → 静默收集             │
                    │  最终返回 AdapterChatResponse            │
                    └─────────────────────────────────────────┘
```

两种模式共用同一份 SSE 解析逻辑，adapter 内部不区分模式，只判断 `onStreamAction` 是否存在。
