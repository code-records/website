https://github.com/StackExchange/Stacks-Editor/issues/342
https://github.com/StackExchange/Stacks-Editor/issues/504



1. 删除原生标签的样式
html, body、p、h1 ...

2. @media 覆盖的标签
html > .editor
body > .editor
...


# sass
@use "sass:meta";
@import "@stackoverflow/stacks-editor/dist/styles.css";
@import "./stacks.scss";

// @import "../stackoverflow/stacks.scss";

// 将所有 stacks 样式包裹在 .admin 选择器内
.admin {
    // 导入 stacks 样式
    // @include meta.load-css("@stackoverflow/stacks/dist/css/stacks.css");

    // 导入 stacks-editor 样式
    // @include meta.load-css("@stackoverflow/stacks-editor/dist/styles.css");
}