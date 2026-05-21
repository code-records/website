# A2UI Runtime

This directory is the chat-side integration layer for Google A2UI v0.9.

UI payloads are official A2UI v0.9 server-to-client messages submitted through
the local `a2ui` tool and rendered through the official React renderer.

## Official Packages

- `@a2ui/web_core/v0_9`: official `MessageProcessor`, schemas, surface model,
  data model, client capabilities, and client-to-server action dispatch.
- `@a2ui/react/v0_9`: official React `A2uiSurface`, `basicCatalog`, component
  implementations, and markdown context.
- `@a2ui/markdown-it`: markdown renderer used by the official `Text` component.

## Tool Payload

Agents submit UI through the local `a2ui` tool:

```json
{
  "a2ui": [
    {
      "version": "v0.9",
      "createSurface": {
        "surfaceId": "example",
        "catalogId": "https://a2ui.org/specification/v0_9/basic_catalog.json",
        "sendDataModel": true
      }
    },
    {
      "version": "v0.9",
      "updateComponents": {
        "surfaceId": "example",
        "components": [
          { "id": "root", "component": "Column", "children": ["title", "button"] },
          { "id": "title", "component": "Text", "text": { "path": "/title" } },
          { "id": "button", "component": "Button", "child": "button-text", "action": { "event": { "name": "ask_followup", "context": { "question": { "path": "/question" } } } } },
          { "id": "button-text", "component": "Text", "text": "继续问" }
        ]
      }
    },
    {
      "version": "v0.9",
      "updateDataModel": {
        "surfaceId": "example",
        "path": "/",
        "value": {
          "title": "A2UI 已接入",
          "question": "如何继续？"
        }
      }
    }
  ]
}
```

The `a2ui` value may be a single A2UI message, an A2UI message array, or the
official `{"messages":[...]}` wrapper. It is validated with the official
`A2uiMessageSchema`, `A2uiMessageListSchema`, and
`A2uiMessageListWrapperSchema` exports before it reaches `MessageProcessor`.

## Runtime Flow

```text
Agent calls a2ui
  -> docsAgent tool validates the official A2UI payload
  -> Turn stores the emitted A2UI messages from the tool event
  -> Chat writes message.a2ui into the assistant message
  -> ChatPanel passes message.a2ui to A2UIRuntime
  -> A2UIRuntime validates official A2UI payloads and passes them to MessageProcessor
  -> ChatPanel renders each surface with A2UISurface next to the message that created it
  -> A2UI actions return through MessageProcessor action callback
  -> Chat sends { a2uiClientMessage, metadata } back to the agent
```

`A2UIRuntime.getClientMetadata()` returns:

- `a2uiClientCapabilities`, generated from the official processor.
- `a2uiClientDataModel`, when at least one surface was created with
  `sendDataModel: true`.

Client actions are sent back as an A2A-style data part:

```json
{
  "kind": "data",
  "data": [
    {
      "version": "v0.9",
      "action": {
        "name": "ask_followup",
        "surfaceId": "example",
        "sourceComponentId": "button",
        "timestamp": "2026-01-15T12:00:00.000Z",
        "context": {
          "question": "如何继续？"
        }
      }
    }
  ],
  "metadata": {
    "mimeType": "application/json+a2ui",
    "a2uiClientCapabilities": {
      "v0.9": {
        "supportedCatalogIds": ["https://a2ui.org/specification/v0_9/basic_catalog.json"]
      }
    }
  }
}
```

## File Map

- `A2UIRuntime.js`: thin adapter around official `MessageProcessor`.
- `A2UICatalog.js`: exports the official React `basicCatalog` used by the
  runtime and prompt.
- `A2UISurface.jsx`: React wrapper around official `A2uiSurface` plus local frame
  styling and markdown renderer wiring.
- `A2UIPrompt.js`: prompt text generated from official client capabilities.
- `A2UITransport.js`: `a2ui` tool schema, A2UI MIME type, A2A data-part helper,
  and A2UI payload parsing.
