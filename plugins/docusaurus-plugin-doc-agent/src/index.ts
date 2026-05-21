import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { PluginModule, PostCssOptions } from '@docusaurus/types';
import tailwindPostcss from '@tailwindcss/postcss';

export interface DocAgentModelOption {
  label?: string;
  model: string;
  endpoint?: string;
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
}

export interface DocAgentPluginOptions {
  defaultModel: string;
  modelOptions: DocAgentModelOption[];
  gitee?: DocAgentGiteeOptions;
  github?: DocAgentGithubOptions;
  prompt?: string;
  routePath?: string;
}

const docAgentPlugin: PluginModule<DocAgentPluginOptions> = (_context, options) => {
  const pluginOptions = options as DocAgentPluginOptions;
  const routePath = pluginOptions.routePath || '/chat';

  return {
    name: 'docusaurus-plugin-doc-agent',

    contentLoaded({ actions }) {
      actions.setGlobalData(pluginOptions);
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
  };
};

export default docAgentPlugin;
