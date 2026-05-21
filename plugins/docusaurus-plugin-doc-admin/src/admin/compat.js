/**
 * 兼容性处理工具
 * 用于在文档内容录入时进行自动替换或校准
 */

/**
 * 应用内容兼容性转换
 * @param {string} content 原始文档内容
 * @returns {string} 转换后的内容
 */
export function applyCompat(content) {
    if (typeof content !== 'string') return content;

    // 如果没有关键标识符且没有 HTML 标签，则快速返回以提升性能
    if (!content.includes('/uploads/') && !content.includes('<') && !content.includes('<!--')) {
        return content;
    }

    let result = content;

    // 1. 图片路径自动修复 (核心逻辑：给 /uploads/ 加上绝对链接)
    // 匹配样式1 (Markdown): ![](/uploads/...)
    // 匹配样式2 (HTML): <img src="/uploads/..." />
    // 匹配样式3 (普通链接): (/uploads/...)
    // 逻辑：寻找 /uploads/ 且前面没有域名标识的路径，加上 docs-center 的域名
    result = result.replace(/(^|[^a-zA-Z0-9.\-_])\/uploads\/([^)\s"']+)/g, (match, prefix, path) => {
        // 如果前面已经是 http 或域名斜杠，正则已经通过 [^a-zA-Z0-9.\-_] 过滤
        // 直接转换为绝对链接
        return `${prefix}https://docs-center.dobest.cn/uploads/${path}`;
    });

    // 2. MD -> MDX 语法转换 (处理从旧系统/工具复制文档时的语法冲突)

    // A. 处理 HTML 注释: <!-- comment --> -> {/* comment */}
    result = result.replace(/<!--\s*([\s\S]*?)\s*-->/g, '{/* $1 */}');

    // B. 自闭合 HTML 标签: <br> <hr> <img> -> <br /> <hr /> <img />
    const selfClosingTags = ['br', 'hr', 'img', 'input', 'meta', 'link'];
    selfClosingTags.forEach(tag => {
        const regex = new RegExp(`<${tag}\\b([^>]*?)(?<!/)>`, 'gi');
        result = result.replace(regex, `<${tag}$1 />`);
    });

    // C. 处理属性中的 style (MDX 要求 style 必须是对象)
    // 同时处理 class -> className, for -> htmlFor
    const tagsWithAttrs = ['div', 'span', 'p', 'font', 'section', 'details', 'summary', 'table', 'tr', 'td', 'th'];
    tagsWithAttrs.forEach(tag => {
        const regex = new RegExp(`<${tag}\\b([^>]+)>`, 'gi');
        result = result.replace(regex, (match, attrs) => {
            let newAttrs = attrs
                .replace(/\bclass=(["'])(.*?)\1/gi, 'className=$1$2$1')
                .replace(/\bfor=(["'])(.*?)\1/gi, 'htmlFor=$1$2$1')
                .replace(/\bstyle=(["'])(.*?)\1/gi, (m, quote, styleStr) => {
                    const styleObj = styleStr.split(';').reduce((acc, curr) => {
                        const parts = curr.split(':');
                        if (parts.length >= 2) {
                            const key = parts[0].trim();
                            const val = parts.slice(1).join(':').trim();
                            const camelKey = key.replace(/-([a-z])/g, g => g[1].toUpperCase());
                            acc.push(`${camelKey}: '${val.replace(/'/g, "\\'")}'`);
                        }
                        return acc;
                    }, []);
                    return styleObj.length ? `style={{${styleObj.join(', ')}}}` : m;
                })
                // 兼容旧版 <font color="red">
                .replace(/\bcolor=(["'])(.*?)\1/gi, (m, quote, color) => {
                    if (match.toLowerCase().startsWith('<font')) {
                        return `style={{color: '${color}'}}`;
                    }
                    return m;
                });
            return `<${tag}${newAttrs}>`;
        });
    });

    return result;
}
