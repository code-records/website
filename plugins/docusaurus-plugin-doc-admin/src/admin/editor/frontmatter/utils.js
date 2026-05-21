/**
 * Frontmatter 解析和序列化工具
 */

/**
 * 从 Markdown 内容中解析 frontmatter
 * @param {string} markdown - 完整的 Markdown 内容
 * @returns {{ frontmatter: object, content: string }} 分离后的 frontmatter 和正文
 */
export function parseFrontmatter(markdown) {
    if (!markdown || typeof markdown !== 'string') {
        return { frontmatter: {}, content: markdown || '', rawFrontmatter: '', separator: '' };
    }

    const trimmed = markdown.trimStart();
    const leadingWhitespace = markdown.substring(0, markdown.length - trimmed.length);

    // 检查是否以 --- 开头
    if (!trimmed.startsWith('---')) {
        return { frontmatter: {}, content: markdown, rawFrontmatter: '', separator: '' };
    }

    // 查找结束的 ---
    const endIndex = trimmed.indexOf('---', 3);
    if (endIndex === -1) {
        return { frontmatter: {}, content: markdown, rawFrontmatter: '', separator: '' };
    }

    // 提取 rawFrontmatter (包含前导空格和完整的 frontmatter 块)
    const rawFrontmatter = leadingWhitespace + trimmed.substring(0, endIndex + 3);

    // 提取 separator 和 content
    const remaining = trimmed.substring(endIndex + 3);
    const content = remaining.trimStart();
    const separator = remaining.substring(0, remaining.length - content.length);

    // 提取 frontmatter 解析用的字符串
    const frontmatterStr = trimmed.substring(3, endIndex).trim();

    // 解析 YAML 格式的 frontmatter
    const frontmatter = {};
    const lines = frontmatterStr.split('\n');

    for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const key = line.substring(0, colonIndex).trim();
        let value = line.substring(colonIndex + 1).trim();

        if (!key) continue;

        // 解析值类型
        if (value === 'true') {
            frontmatter[key] = true;
        } else if (value === 'false') {
            frontmatter[key] = false;
        } else if (value === 'null' || value === '') {
            // 跳过空值
        } else if (/^-?\d+$/.test(value)) {
            frontmatter[key] = parseInt(value, 10);
        } else if (/^-?\d+\.\d+$/.test(value)) {
            frontmatter[key] = parseFloat(value);
        } else {
            // 移除引号
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            frontmatter[key] = value;
        }
    }

    return { frontmatter, content, rawFrontmatter, separator };
}

/**
 * 将 frontmatter 对象序列化为 YAML 字符串
 * @param {object} frontmatter - frontmatter 对象
 * @returns {string} YAML 格式的字符串
 */
export function serializeFrontmatter(frontmatter) {
    if (!frontmatter || Object.keys(frontmatter).length === 0) {
        return '';
    }

    const lines = [];

    for (const [key, value] of Object.entries(frontmatter)) {
        if (value === null || value === undefined || value === '') {
            continue;
        }

        if (typeof value === 'boolean') {
            lines.push(`${key}: ${value}`);
        } else if (typeof value === 'number') {
            lines.push(`${key}: ${value}`);
        } else if (typeof value === 'string') {
            // 如果字符串包含特殊字符，使用引号
            if (value.includes(':') || value.includes('#') || value.includes('\n')) {
                lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
            } else {
                lines.push(`${key}: ${value}`);
            }
        } else {
            // 其他类型转为 JSON
            lines.push(`${key}: ${JSON.stringify(value)}`);
        }
    }

    if (lines.length === 0) {
        return '';
    }

    return `---\n${lines.join('\n')}\n---\n\n`;
}

export function mergeFrontmatter(frontmatter, content) {
    const frontmatterStr = serializeFrontmatter(frontmatter);
    return frontmatterStr + (content || '');
}

/**
 * 在现有的 Markdown 内容中注入/更新 Frontmatter
 * 注意：这会规范化 Frontmatter 和正文之间的分隔符
 * @param {string} markdown - 当前完整的 Markdown
 * @param {object} newFrontmatter - 新的 Frontmatter 对象
 * @returns {string} 更新后的 Markdown
 */
export function injectFrontmatter(markdown, newFrontmatter) {
    // 解析出纯正文（去除原有的 Frontmatter）
    const { content } = parseFrontmatter(markdown);
    // 使用新的 Frontmatter 重新合并
    return mergeFrontmatter(newFrontmatter, content);
}
