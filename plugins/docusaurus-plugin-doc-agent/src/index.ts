import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { PluginModule, PostCssOptions } from '@docusaurus/types';
import tailwindPostcss from '@tailwindcss/postcss';
import type WebpackDevServer from 'webpack-dev-server';

export interface DocAgentModelOption {
  label?: string;
  model: string;
  url?: string;
  streamUrl?: string;
  personalAccessToken?: string;
  adapterType: 'openai' | 'anthropic' | 'gemini';
}

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
   * 代理路径（推荐，安全优先）：
   * 
   * 配置为本地开发服务器或生产环境的反向代理路径（例如 '/agent-tools-github'）。
   * 敏感的 GitHub 个人访问令牌（PAT）将由服务器端/代理安全注入，
   * 绝不会泄露给前端浏览器。
   */
  endpoint?: string;
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
  modelOptions: DocAgentModelOption[];
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
    },

    getPathsToWatch() {
      return [__dirname];
    },

    getThemePath() {
      return path.join(__dirname, 'theme');
    },

    getClientModules() {
      return [path.join(__dirname, 'clientModules/doc-agent.css')];
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
