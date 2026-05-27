import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { PluginModule, PostCssOptions } from '@docusaurus/types';
import tailwindPostcss from '@tailwindcss/postcss';
import type WebpackDevServer from 'webpack-dev-server';

export type DocAgentProviderAdapter = 'openai' | 'anthropic' | 'gemini';

export interface DocAgentProviderOption {
  adapter: DocAgentProviderAdapter;
  personalAccessToken?: string;
  models: Record<string, string>;
}

export type DocAgentProviders = Record<string, DocAgentProviderOption>;

export interface DocAgentGiteeOptions {
  owner: string;
  repo: string;
  ref: string;
}

export interface DocAgentGithubOptions {
  owner: string;
  repo: string;
  ref: string;
  /**
   * 个人访问令牌（Pages 纯静态托管 fallback，有安全隐患）：
   * 
   * 如果部署在 GitHub Pages 等纯静态托管平台，并且没有配置反向代理服务器，
   * 可在此直接配置此 Token。
   * 注意：这会导致该 Token 被打包进前端静态资源中并直接在浏览器端发起请求，可能会泄露给前端用户！
   */
  personalAccessToken?: string;
}

export interface DocAgentPluginOptions {
  defaultModel: string;
  providers: DocAgentProviders;
  gitee?: DocAgentGiteeOptions;
  github?: DocAgentGithubOptions;
  prompt?: string;
  routePath: string;
}

type DocAgentPluginUserOptions = Omit<DocAgentPluginOptions, 'routePath'> &
  Partial<Pick<DocAgentPluginOptions, 'routePath'>>;

const DEFAULT_ROUTE_PATH = '/chat';

const docAgentPlugin: PluginModule = (_context, options) => {
  const userOptions = options as DocAgentPluginUserOptions;
  const pluginOptions: DocAgentPluginOptions = {
    ...userOptions,
    routePath: userOptions.routePath ?? DEFAULT_ROUTE_PATH,
  };

  return {
    name: 'docusaurus-plugin-doc-agent',

    contentLoaded({ actions }) {
      actions.setGlobalData(pluginOptions);
      actions.addRoute({
        path: pluginOptions.routePath,
        component: path.join(__dirname, 'pages/ChatPage.jsx'),
        exact: true,
      });
      actions.addRoute({
        path: '/code',
        component: path.join(__dirname, 'pages/CodePage.jsx'),
        exact: true,
      });
    },

    getPathsToWatch() {
      return [__dirname];
    },

    getThemePath() {
      return path.join(__dirname, 'theme');
    },

    getClientModules() {
      return [path.join(__dirname, 'css/style.css')];
    },

    async postBuild({ outDir }) {
      execFileSync('npx', ['--yes', 'pagefind@1.5.2', '--site', outDir], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
    },

    configurePostCss(postcssOptions: PostCssOptions) {
      const plugins = postcssOptions.plugins || [];
      postcssOptions.plugins = [tailwindPostcss(), ...plugins];
      return postcssOptions;
    },

    configureWebpack() {
      const devServer: WebpackDevServer.Configuration = {
        static: [
          {
            directory: path.join(process.cwd(), 'build', 'pagefind'),
            publicPath: '/pagefind',
          },
        ],
      };
      return { devServer };
    },
  };
};

export default docAgentPlugin;
