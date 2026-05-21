# Model

`model/` 负责 provider 适配：把 OpenAI / Claude / Gemini 等不同接口统一成 AskSky 内部的 `ModelEvent` 流。

## 职责边界

- 处理 provider 请求格式、消息格式、工具定义格式。
- 处理 provider 原始 stream chunk 或完整 chat/complete response。
- 对外只产出统一的 `ModelEvent`。
- 不实现 agent loop，不执行工具，不持有业务状态。

## Stream 契约

AskSky 对外只认自己的事件流，不直接暴露 provider 原始返回结构。

```text
原生 stream 模式：
  provider stream chunk
    -> Model.stream() 解析并转换
    -> yield ModelEvent
    -> yield done(response)

原生 chat/complete 模式：
  provider 完整响应
    -> Model.stream() 包装成一段合成事件流
    -> yield content_delta / tool_call_done
    -> yield done(response)
```

因此 `Model.stream()` 是模型层唯一必须实现的公共主接口。provider 是否真的调用原生 stream 接口，是模型子类自己的实现细节。

## Complete 契约

`Model.complete()` 是便捷层，默认消费 `Model.stream()` 并等待 `done(response)`。

```text
Model.complete()
  -> consume Model.stream()
  -> return done(response)
```

provider 后续可以为了性能覆盖 `complete()`，但不能改变公共语义：调用方拿到的仍然必须是标准 `ModelResponse`。
