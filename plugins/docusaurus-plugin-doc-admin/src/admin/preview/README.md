# Preview Core

此目录包含 Admin 后台实时预览的核心逻辑。

## 依赖说明

### remark-heading-id
- **版本**: `^1.0.1`
- **状态**: 暂未启用 (目前使用正则过滤 `{#id}` 语法)
- **计划**: 未来版本中计划重新集成此插件，以支持 Docusaurus 的自定义标题 ID 语法 `{#custom-id}`，替代当前的正则清洗方案。

## 当前处理方案
为避免 `{#id}` 被 MDX 误解析为 JSX 表达式导致 Acorn 报错，目前在 `mdxCompiler.js` 中使用 `IGNORED_PATTERNS` 数组在编译前移除如果不被支持的 Docusaurus 特有语法。
