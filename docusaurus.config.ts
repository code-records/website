import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { getDocusaurusConfigI18n } from './docusaurus.config.ts.i18n';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const locale = process.env.DOCUSAURUS_CURRENT_LOCALE;
const i18n = getDocusaurusConfigI18n(locale);
const GITHUB_PERSONAL_ACCESS_TOKEN = Buffer.from(
  'Z2l0aHViX3BhdF8xMUFESllPS1kwaFNiVXQxY3FnZXVJX0FKRFFSOXJFM29sc0NvMlpKSjlQVGVRZXlRNXBDejNIRUFPZVg3ZXpFaVg1Nk5UVExUVnEwbHZTeHFY',
  'base64'
).toString('utf-8');

const GEMINI_API_KEY = Buffer.from(
  'QUl6YVN5QlBsTnVyb2xpdzFPMVZ6TlVqcGx4ckV2cjh0S0hUWkMw',
  'base64'
).toString('utf-8');

const config: Config = {
  title: i18n.site.title,
  tagline: i18n.site.tagline,
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://dev.xxx.com',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'dev', // Usually your GitHub org/user name.
  projectName: 'dev', // Usually your repo name.

  onBrokenLinks: 'throw',

  // npm run write-translations
  // npm run write-translations -- --locale en
  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans', 'en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    // [
    //   'docusaurus-plugin-doc-admin',
    //   {
    //     gitee: {
    //       owner: 'xxx',
    //       repo: 'xxx',
    //       ref: 'dev',
    //       clientId: 'xxx',
    //       clientSecret: 'xxx',
    //     },
    //   },
    // ],
    [
      'docusaurus-plugin-doc-agent',
      {
        defaultModel: 'gemini-3.5-flash',
        modelOptions: [
          {
            label: 'Gemini 3.5 Flash',
            model: 'gemini-3.5-flash',
            adapterType: 'gemini',
            personalAccessToken: GEMINI_API_KEY, // 👈 静态 Pages 托管直连官方 API（无需配置代理端点）
          },
          {
            label: 'Gemini 3.1 Flash-Lite',
            model: 'gemini-3.1-flash-lite',
            adapterType: 'gemini',
            personalAccessToken: GEMINI_API_KEY,
          },
          {
            label: 'Gemini 2.5 Flash',
            model: 'gemini-2.5-flash',
            adapterType: 'gemini',
            personalAccessToken: GEMINI_API_KEY,
          },
        ],
        prompt: i18n.docAgent.prompt,
        github: {
          owner: 'code-records',
          repo: 'website',
          ref: 'main',
          personalAccessToken: GITHUB_PERSONAL_ACCESS_TOKEN,
        },
      },
    ],
  ],

  themeConfig: {
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    metadata: [{ name: 'keywords', content: i18n.site.keywords.join(', ') }],
    navbar: {
      title: i18n.navbar.title,
      logo: {
        alt: i18n.navbar.logoAlt,
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: i18n.navbar.docsLabel,
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        // {
        //   title: i18n.footer.docsColumnTitle,
        //   items: [
        //     {
        //       label: i18n.footer.docsLabel,
        //       to: '',
        //     },
        //     {
        //       label: i18n.footer.contactLabel,
        //       to: '',
        //     },
        //   ],
        // },
        // {
        //   title: i18n.footer.openSourceColumnTitle,
        //   items: [
        //     {
        //       label: i18n.footer.githubLabel,
        //       href: '',
        //     },
        //   ],
        // },
        // {
        //   title: i18n.footer.moreColumnTitle,
        //   items: [
        //     {
        //       label: i18n.footer.mainSiteLabel,
        //       href: '',
        //     },
        //     {
        //       label: i18n.footer.galleryLabel,
        //       href: '',
        //     },
        //   ],
        // },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} ${i18n.site.title}.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
