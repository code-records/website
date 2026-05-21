import { A2UI_BASIC_CATALOG_ID } from './A2UICatalog.js';

let cachedPromptText = null;

function getTransportInstructions({ toolName = 'a2ui', payloadParameter = 'a2ui' } = {}) {
    return [
        `- When UI is useful, call the \`${toolName}\` tool with the A2UI payload. Do not print A2UI JSON in the final answer.`,
        `- \`${toolName}.${payloadParameter}\` may be one v0.9 message, an array of messages, or \`{"messages":[...]}\`. Prefer an array.`,
        '- Use the final Markdown answer for normal explanations and summaries.',
    ].join('\n');
}

function getCompactA2UIPromptText(options = {}) {
    const catalogId = A2UI_BASIC_CATALOG_ID;

    return `## A2UI v0.9 output rules

Transport:
${getTransportInstructions(options)}

Catalog:
- catalogId: ${catalogId}
- components: Text, Image, Icon, Video, AudioPlayer, Row, Column, List, Card, Tabs, Divider, Modal, Button, TextField, CheckBox, ChoicePicker, Slider, DateTimeInput

Rules:
- Only call \`a2ui\` when structured UI clearly improves the experience.
- Payload must be valid JSON shaped like \`{"a2ui":[...]}\`.
- Every message needs \`"version":"v0.9"\` and exactly one update key: \`createSurface\`, \`updateComponents\`, \`updateDataModel\`, or \`deleteSurface\`.
- For a new surface, send \`createSurface\` first, then \`updateComponents\` and optional \`updateDataModel\`. \`createSurface.catalogId\` must be \`${catalogId}\`.
- If metadata \`a2uiClientSurfaceIds\` already contains the target surface, update it or delete then recreate it; do not duplicate create.
- Every surface needs a component with id \`root\`. Component names use PascalCase. Child components must be declared separately and referenced by id.
- Button must use \`child\` referencing a Text or Icon component. Button does not render label/text/title fields.
- Use \`action.event\` for interactions, e.g. \`{"action":{"event":{"name":"ask_followup","context":{"question":"..."}}}}\`.
- If the user message has \`kind:"a2uiClientMessage"\`, continue from \`action.name\` and \`action.context\`.`;
}

export function getA2UIPromptText(options = {}) {
    if (cachedPromptText && !Object.keys(options).length) return cachedPromptText;

    const promptText = getCompactA2UIPromptText(options);
    if (!Object.keys(options).length) cachedPromptText = promptText;
    return promptText;
}
