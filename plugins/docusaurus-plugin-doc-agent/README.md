# docusaurus-plugin-doc-agent

AI documentation assistant migrated from `docs.dobest.cn/src-spa/ai`.

## Current State

This package is intentionally a first-pass migration. It owns its runtime dependencies and injects the assistant from a Docusaurus theme `Root` component.

## Docusaurus Config

`defaultModel` and `modelOptions` are required. The plugin does not provide built-in model defaults.

```ts
plugins: [
  [
    require.resolve('./plugins/docusaurus-plugin-doc-agent'),
    {
      defaultModel: 'gpt-5.5',
      modelOptions: [
        {
          label: 'GPT-5.5',
          model: 'gpt-5.5',
          adapterType: 'openai',
          endpoint: '/agent/v1/responses',
        },
      ],
      prompt: `你是文档助手，专门回答游戏 SDK 接入相关问题。

回答要求：
- 用自己的话提炼步骤、参数、注意事项。
- 回答简洁直接，避免重复和废话。`,
    },
  ],
]
```

`prompt` 用来配置站点身份和回答风格。搜索、读取文档、相对 URL、引用规则等执行方式由插件内置 prompt 维护。

## Agent Standalone Build

以下命令都以 `plugins/docusaurus-plugin-doc-agent` 为当前目录执行。agent 入口为 `src/agent/index.ts`。

### ESM

```powershell
npx --yes esbuild@latest src/agent/index.ts `
  --bundle `
  --format=esm `
  --platform=browser `
  --target=es2020 `
  --minify `
  --outfile=dist/agent.esm.min.js
```

ESM 使用方式：

```js
import { Agent } from './dist/agent.esm.min.js';
```

### UMD

`esbuild` 不直接支持 `format=umd`，先生成 CJS 临时文件，再包一层 UMD wrapper。

```powershell
npx --yes esbuild@latest src/agent/index.ts `
  --bundle `
  --format=cjs `
  --platform=browser `
  --target=es2020 `
  --minify `
  --outfile=dist/agent.cjs.tmp

$body = Get-Content -LiteralPath 'dist/agent.cjs.tmp' -Raw
$prefix = '(function(root,factory){if(typeof define==="function"&&define.amd){define([],factory)}else if(typeof module==="object"&&module.exports){module.exports=factory()}else{root.DocAgent=factory()}})(typeof globalThis!=="undefined"?globalThis:typeof self!=="undefined"?self:this,function(){"use strict";var module={exports:{}};var exports=module.exports;'
$suffix = ';return module.exports;});'
Set-Content -LiteralPath 'dist/agent.umd.min.js' -Value ($prefix + $body + $suffix) -NoNewline -Encoding UTF8
```

普通 HTML 使用方式：

```html
<script src="./dist/agent.umd.min.js"></script>
<script>
  const agent = new DocAgent.Agent();
</script>
```

## Dev Proxy Plugin

`docusaurus.config.ts.dev.ts`:

```ts
import * as path from 'node:path';
import type { PluginModule } from '@docusaurus/types';
import type WebpackDevServer from 'webpack-dev-server';

type DevServerConfiguration = WebpackDevServer.Configuration;
type DevServerProxy = NonNullable<DevServerConfiguration['proxy']>;

const proxy: DevServerProxy = [
  {
    context: ['/agent-tools-gitlab'],
    target: 'https://gitlab.com',
    changeOrigin: true,
    secure: false,
    pathRewrite: { '^/agent-tools-gitlab': '' },
    headers: {
      'Private-Token': 'CxnibP4Ws4hrks_7-E8i',
    },
  },
  {
    context: ['/agent-tools-gitee'],
    target: 'https://gitee.com',
    changeOrigin: true,
    secure: false,
    pathRewrite: (url: string) => {
      url = url.replace(/^\/agent-tools-gitee/, '');
      const [pathname, query = ''] = url.split('?');
      const params = new URLSearchParams(query);
      params.set('access_token', '3ec93ad44535672f7e4ab6b5a374c393');
      return `${pathname}?${params.toString()}`;
    },
  },
  {
    context: ['/agent-api'],
    target: 'https://aicoding.xxx.com',
    changeOrigin: true,
    secure: false,
    pathRewrite: { '^/agent-api': '' },
    headers: {
      'x-api-key': 'sk-e689cbf951b607af8dba8ab0a4953b23edf360a2700cfb033af2a35c02c9ae9f',
      Authorization: 'Bearer sk-e689cbf951b607af8dba8ab0a4953b23edf360a2700cfb033af2a35c02c9ae9f',
    },
  },
];

/**
 * 本地开发代理插件：
 * 1. 由代理统一持有访问令牌，避免在前端暴露密钥。
 * 2. 本地开发时直接读取已生成的 build/pagefind 索引。
 */
export const devProxyPlugin: PluginModule = (_context, _options) => {
  return {
    name: 'dev-proxy-plugin',
    configureWebpack() {
      return {
        mergeStrategy: { 'devServer.proxy': 'replace' },
        devServer: {
          proxy: proxy,
          static: [
            {
              directory: path.join(process.cwd(), 'build', 'pagefind'),
              publicPath: '/pagefind',
            },
          ],
        },
      };
    },
  };
};
```

## Nginx Config

完整的 Nginx 部署与反向代理配置，请参考同目录下的 [nginx.conf](./nginx.conf)。

## Runtime Assumptions

- Run `docusaurus build` once to generate `build/pagefind` for local dev.
- `/url-map.json` exists.
- `/gitlab-readonly/api/v4` proxy exists.
- `/agent` proxy exists for model calls.

## Next Items

- Move GitLab readonly project/ref settings out of `src/ai/docsAgent/tools/gitlabReadonly.ts`.
- Generate `url-map.json` from a Docusaurus plugin hook instead of the old slug parser.


