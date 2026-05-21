import * as path from 'node:path';
import type { PluginModule } from '@docusaurus/types';
import type WebpackDevServer from 'webpack-dev-server';

type DevServerConfiguration = WebpackDevServer.Configuration;
type DevServerProxy = NonNullable<DevServerConfiguration['proxy']>;

const proxy: DevServerProxy = [
  {
    context: ['/agent-tools-gitee'],
    target: 'https://gitee.com',
    changeOrigin: true,
    secure: false,
    pathRewrite: (url: string) => {
      url = url.replace(/^\/agent-tools-gitee/, '');
      const [pathname, query = ''] = url.split('?');
      const params = new URLSearchParams(query);
      params.set('access_token', 'xxx');
      return `${pathname}?${params.toString()}`;
    },
  },
  {
    context: ['/agent-tools-github'],
    target: 'https://api.github.com',
    changeOrigin: true,
    secure: true,
    pathRewrite: {
      '^/agent-tools-github': '',
    },
    headers: {
      Authorization: 'Bearer xxx',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'docusaurus-plugin-doc-agent',
    },
  },
  {
    context: ['/agent-api'],
    target: 'https://api.xxx.com',
    changeOrigin: true,
    secure: false,
    pathRewrite: { '^/agent-api': '' },
    headers: {
      'x-api-key': 'sk-xxxx',
      Authorization: 'Bearer sk-xxxx',
    },
  },
  {
    context: ['/agent-gemini'],
    target: 'https://generativelanguage.googleapis.com',
    changeOrigin: true,
    secure: true,
    pathRewrite: { '^/agent-gemini': '' },
    headers: {
      'x-goog-api-key': 'AIzaSyA355gVfI_JofSh--siwtD-107t6RfeBaw',
    },
  },
];

/**
 * 接口代理插件：由代理持有令牌，避免前端暴露密钥。
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

