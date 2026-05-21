import path from 'node:path';
import type { LoadContext, Plugin, PluginModule, PostCssOptions } from '@docusaurus/types';

type DocSetConfig = {
  id?: string;
  label?: string;
  path?: string;
  routeBasePath?: string;
  sidebarPath?: string;
  sidebarKey?: string;
};

type GiteeConfig = {
  provider?: 'gitee';
  owner: string;
  repo: string;
  ref: string;
  clientId: string;
  clientSecret: string;
};

type DocAdminPluginOptions = {
  routePath?: string;
  docSets?: Record<string, DocSetConfig> | DocSetConfig[];
  gitee?: GiteeConfig;
};

const DEFAULT_OPTIONS = {
  routePath: '/admin',
} satisfies Required<Pick<DocAdminPluginOptions, 'routePath'>>;

const DEFAULT_DOCSETS = {
  docs: {
    label: 'Docs',
    path: 'docs',
    routeBasePath: 'docs',
    sidebarPath: 'docs/_meta/sidebars.json',
    sidebarKey: 'sidebar',
  },
} satisfies Record<string, Required<Omit<DocSetConfig, 'id'>>>;

function cleanGitPath(value: unknown): string {
  return String(value || '').replace(/^\.?\//, '').replace(/\\/g, '/');
}

function normalizeDocSets(docSets: DocAdminPluginOptions['docSets'] = DEFAULT_DOCSETS) {
  const entries = Array.isArray(docSets)
    ? docSets.map((docSet) => [docSet.id || docSet.path, docSet] as const)
    : Object.entries(docSets);

  const normalized = entries.reduce<Record<string, Required<Omit<DocSetConfig, 'id'>>>>(
    (result, [id, docSet]) => {
      if (!id || !docSet) return result;

      const pathValue = cleanGitPath(docSet.path || id);
      result[id] = {
        label: docSet.label || id,
        path: pathValue,
        routeBasePath: docSet.routeBasePath || pathValue,
        sidebarPath: cleanGitPath(docSet.sidebarPath || `${pathValue}/_meta/sidebars.json`),
        sidebarKey: docSet.sidebarKey || 'sidebar',
      };

      return result;
    },
    {},
  );

  return Object.keys(normalized).length > 0 ? normalized : DEFAULT_DOCSETS;
}

function normalizeGiteeConfig(gitee: DocAdminPluginOptions['gitee']) {
  if (!gitee?.owner || !gitee?.repo || !gitee?.ref || !gitee?.clientId || !gitee?.clientSecret) {
    throw new Error(
      'docusaurus-plugin-doc-admin requires gitee.owner, gitee.repo, gitee.ref, gitee.clientId and gitee.clientSecret options.',
    );
  }

  return {
    provider: 'gitee',
    ...gitee,
  };
}

function normalizePluginOptions(options: unknown): DocAdminPluginOptions {
  return options && typeof options === 'object' ? (options as DocAdminPluginOptions) : {};
}

const docAdminPlugin: PluginModule = (
  _context: LoadContext,
  options: unknown = {},
): Plugin => {
  const normalizedOptions = normalizePluginOptions(options);
  const pluginOptions = {
    ...DEFAULT_OPTIONS,
    ...normalizedOptions,
  };
  const docSets = normalizeDocSets(pluginOptions.docSets);
  const gitee = normalizeGiteeConfig(pluginOptions.gitee);

  return {
    name: 'docusaurus-plugin-doc-admin',

    getPathsToWatch() {
      return [__dirname];
    },

    getClientModules() {
      return [path.join(__dirname, 'clientModules/doc-admin.css')];
    },

    configurePostCss(postcssOptions: PostCssOptions) {
      const plugins = postcssOptions.plugins || [];
      const hasTailwind = plugins.some(
        (plugin) =>
          typeof plugin === 'object' &&
          plugin !== null &&
          'postcssPlugin' in plugin &&
          plugin.postcssPlugin === '@tailwindcss/postcss',
      );
      postcssOptions.plugins = hasTailwind
        ? plugins
        : [require('@tailwindcss/postcss'), ...plugins];
      return postcssOptions;
    },

    contentLoaded({ actions }) {
      actions.setGlobalData({ docSets, gitee });
      actions.addRoute({
        path: pluginOptions.routePath,
        component: path.join(__dirname, 'Main.jsx'),
        exact: false,
      });
    },
  };
};

export default docAdminPlugin;
