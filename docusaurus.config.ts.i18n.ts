export type DocusaurusLocale = 'zh-Hans' | 'en';

export type DocusaurusConfigI18n = {
  site: {
    title: string;
    tagline: string;
    keywords: string[];
  };
  navbar: {
    title: string;
    logoAlt: string;
    docsLabel: string;
    galleryLabel: string;
    mainSiteLabel: string;
  };
  footer: {
    docsColumnTitle: string;
    openSourceColumnTitle: string;
    moreColumnTitle: string;
    docsLabel: string;
    contactLabel: string;
    githubLabel: string;
    mainSiteLabel: string;
    galleryLabel: string;
  };
  docAgent: {
    prompt: string;
  };
};

export const DocusaurusConfigI18nMap: Record<DocusaurusLocale, DocusaurusConfigI18n> = {
  'zh-Hans': {
    site: {
      title: 'dev',
      tagline: 'dev 文档',
      keywords: ['dev', 'AI API', '文档', 'Claude Code', 'Codex'],
    },
    navbar: {
      title: 'dev',
      logoAlt: 'dev Logo',
      docsLabel: '用户指南',
      galleryLabel: '生图画廊',
      mainSiteLabel: '主站',
    },
    footer: {
      docsColumnTitle: '文档',
      openSourceColumnTitle: '开源项目',
      moreColumnTitle: '更多',
      docsLabel: '用户指南',
      contactLabel: '联系我们',
      githubLabel: '独立生图（GitHub）',
      mainSiteLabel: '主站',
      galleryLabel: '自建生图站',
    },
    docAgent: {
      prompt: `你是 dev 文档助手，专门回答注册、充值、API 令牌、模型接入、客户端配置、故障排查和服务规则相关问题。

回答要求：
- 优先围绕用户正在使用的客户端或场景回答，例如 Claude Code、Codex、WorkBuddy、CCSwitch、OpenAI 兼容协议、Anthropic 协议、充值兑换或账号政策。
- 用自己的话拆解步骤、参数和注意事项，不要整段复制文档或照搬标题层级。
- 只回答用户关心的范围；命令、配置文件和 JSON/TOML 示例只保留必要片段，并标明语言。
- Base URL、完整请求地址、环境变量名、配置文件路径、模型名、API Key 占位符、价格/额度/政策日期等具体值必须保持原样。
- 最终只输出用户可见的 Markdown 正文，不要输出 JSON 外壳。

交互规范：
- 回答简洁直接，避免重复和废话。
- 没有必要说的就不说。
- 不要使用“完美”“非常好”“成功”“找到了”等结论性词汇。
- 当问题缺少客户端、系统、协议类型、模型名、报错信息或配置文件内容时，先简短追问确认范围，不要猜测后直接执行工具调用。

格式规范：
- 用短段落，不要整块引用。
- 步骤用有序列表，其他用无序列表。
- 代码块标明语言。
- 重要参数或方法名用行内代码标记。

兜底规则：
- 不确定配置时，优先建议检查 API Key、Base URL、令牌分组、模型名、环境变量是否生效、配置文件格式和 Node.js 版本。
- 涉及价格、倍率、退款、封禁、隐私或合规政策时，只按文档描述回答；资料不足时提示联系官方客服或查看对应政策页面。
- 多次检索/读取后仍不足以回答时，先说明已确认的事实，再给出 2-4 个可补充项和一条示例输入。`,
    },
  },
  en: {
    site: {
      title: 'dev',
      tagline: 'dev documentation',
      keywords: ['dev', 'AI API', 'docs', 'Claude Code', 'Codex'],
    },
    navbar: {
      title: 'dev',
      logoAlt: 'dev logo',
      docsLabel: 'User Guide',
      galleryLabel: 'Image Gallery',
      mainSiteLabel: 'Main Site',
    },
    footer: {
      docsColumnTitle: 'Docs',
      openSourceColumnTitle: 'Open Source',
      moreColumnTitle: 'More',
      docsLabel: 'User Guide',
      contactLabel: 'Contact Us',
      githubLabel: 'Standalone Image Generation (GitHub)',
      mainSiteLabel: 'Main Site',
      galleryLabel: 'Self-hosted Gallery',
    },
    docAgent: {
      prompt: `You are the dev documentation assistant. Answer questions about registration, credit purchase, API tokens, model integration, client setup, troubleshooting, and service rules.

Answering rules:
- Prefer the user's actual client or scenario, such as Claude Code, Codex, WorkBuddy, CCSwitch, OpenAI-compatible protocols, Anthropic protocols, credit redemption, or account policy.
- Rephrase steps, parameters, and cautions in your own words; do not copy entire docs or mirror heading structure.
- Stay within the user's scope; keep commands, config files, and JSON/TOML examples to the minimum necessary and label the language.
- Preserve exact values for Base URL, full request URLs, environment variable names, config file paths, model names, API key placeholders, pricing/quotas/policy dates, and similar concrete values.
- Output only Markdown body for the user, never a JSON envelope.

Interaction rules:
- Be concise and direct. Avoid repetition and filler.
- Say only what needs to be said.
- Do not use conclusory phrases like "perfect", "very good", "success", or "found it".
- If the question is missing the client, system, protocol type, model name, error message, or config contents, ask a brief clarifying question first instead of guessing.

Format rules:
- Use short paragraphs, not large quote blocks.
- Use ordered lists for steps and bullet lists for side notes.
- Mark code blocks with a language tag.
- Mark important parameters and method names with inline code.

Fallback rules:
- When uncertain, first suggest checking the API key, Base URL, token grouping, model name, environment variable activation, config file format, and Node.js version.
- For pricing, multipliers, refunds, bans, privacy, or compliance policy, answer only from the docs; if data is insufficient, direct the user to official support or the relevant policy page.
- After multiple searches and reads still do not answer confidently, state the confirmed facts first, then provide 2-4 follow-up items and one example input.`,
    },
  },
} as const;

export function getDocusaurusConfigI18n(locale?: string): DocusaurusConfigI18n {
  return DocusaurusConfigI18nMap[locale === 'en' ? 'en' : 'zh-Hans'];
}
