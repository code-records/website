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

export interface DocAgentProviderOption {
  adapter: 'openai' | 'anthropic' | 'gemini';
  /**
   * 普通 API 请求端点或端点模板：
   * 
   * 不配置时使用各 provider 内置的官方默认端点；需要反向代理或兼容服务时再配置。
   * Gemini 支持在端点中使用 `{model}` 占位符，例如
   * 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'。
   * 若要隐藏 API Key，请配置自有服务端反代，并不要配置 `personalAccessToken`。
   */
  url?: string;
  /**
   * 流式 API 请求端点或端点模板：
   * 
   * 当流式接口与普通非流式接口使用不同的代理路径（例如因 Nginx/CDN 单独配置 SSE 路由）时进行配置。
   * Gemini 支持在端点中使用 `{model}` 占位符，例如
   * 'https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse'。
   * Gemini 不配置此项时使用官方默认流式端点；如果要走自定义反代，建议同时配置 `url` 和 `streamUrl`。
   */
  streamUrl?: string;
  /**
   * 个人访问令牌/API密钥（Pages 纯静态托管 fallback，有安全隐患）：
   * 
   * 如果部署在 GitHub Pages 等纯静态托管平台，并且没有配置反向代理服务器，
   * 可在此直接配置此 Token/API Key。
   * 注意：这会导致该 Key 被打包进前端静态资源中并直接在浏览器端发起请求，可能会泄露给前端用户！
   */
  personalAccessToken?: string;
  models: Record<string, string>;
}

export interface DocAgentPluginOptions {
  defaultModel: string;
  providers?: Record<string, DocAgentProviderOption>;
  modelOptions?: DocAgentModelOption[];
  gitee?: DocAgentGiteeOptions;
  github?: DocAgentGithubOptions;
  prompt?: string;
  routePath?: string;
}


const docAgentPlugin: PluginModule<DocAgentPluginOptions> = (_context, options) => {
  const pluginOptions = options as DocAgentPluginOptions;
  const routePath = pluginOptions.routePath || '/chat';

  let modelOptions: DocAgentModelOption[] = pluginOptions.modelOptions || [];
  if (pluginOptions.providers) {
    const flatOptions: DocAgentModelOption[] = [];
    for (const providerConf of Object.values(pluginOptions.providers)) {
      if (providerConf && providerConf.models) {
        for (const [modelId, label] of Object.entries(providerConf.models)) {
          flatOptions.push({
            label,
            model: modelId,
            url: providerConf.url,
            streamUrl: providerConf.streamUrl,
            personalAccessToken: providerConf.personalAccessToken,
            adapterType: providerConf.adapter,
          });
        }
      }
    }
    modelOptions = flatOptions;
  }

  return {
    name: 'docusaurus-plugin-doc-agent',

    contentLoaded({ actions }) {
      actions.setGlobalData({
        ...pluginOptions,
        modelOptions,
        routePath,
      });
      actions.addRoute({
        path: routePath,
        component: path.join(__dirname, 'ChatPage.jsx'),
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
