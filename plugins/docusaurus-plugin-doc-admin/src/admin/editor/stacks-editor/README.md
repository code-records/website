# Editor CSS - 不可改为 Tailwind

本目录及上级 `editor/` 目录下的 CSS **必须保留为传统 CSS**，不能迁移到 Tailwind。

## ⚠️ 关键类名：`editor`

`editor/index.jsx` 中 `className="editor ..."` 的 **`editor` 类名绝对不能删除**。

`stacks.css` 框架内部（约第 1873 行）引用了 `.editor` 选择器。删除此类名会导致编辑器布局完全崩溃。可以在旁边追加 Tailwind 类，但 `editor` 必须保留。

## 原因

### 1. `stacks.css` (628KB) — 第三方框架裁剪版

从 `@stackoverflow/stacks` 框架手动裁剪而来，去掉了会污染 Docusaurus 全局样式的部分（`html/body/p/h1` 重置和 `@media` 覆盖）。

框架内部引用了 `.editor` 类名（约 1873 行），因此 `editor/index.jsx` 中的 `className="editor ..."` 不能删除 `editor`。

相关 issue:
- https://github.com/StackExchange/Stacks-Editor/issues/342
- https://github.com/StackExchange/Stacks-Editor/issues/504

### 2. `StacksEditor.css` — 库覆盖层

- `.stacks-editor-container` 类名是所有覆盖规则的命名空间前缀（130+ 行选择器以它开头），不能删除
- 所有覆盖规则目标是库生成的内部 DOM（`.ProseMirror`、`.js-editor`、`.s-textarea` 等），无法用 Tailwind 替代
- `.toolbar-sort-*` 通过 Portal 注入到 stacks toolbar DOM 内，stacks 框架的宽泛选择器会覆盖 Tailwind 类

### 3. CSS 加载顺序关键

StacksEditor.jsx 中的 import 顺序**不可更改**：

```js
import "@stackoverflow/stacks-editor/dist/styles.css";  // 1. 库原始样式
import "./stacks/stacks.css";                            // 2. 裁剪版框架
import "./StacksEditor.css";                             // 3. 我们的覆盖（必须最后）
```

如果将覆盖样式移到其他文件（如全局 admin.css），webpack 会改变加载顺序，导致库样式反向覆盖我们的规则。
