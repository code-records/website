/**
 * Admin 专用 Monaco Editor 业务工具函数集
 * 就近自包含：放置于组件目录内部
 */

import prettier from 'prettier/standalone';
import parserBabel from 'prettier/parser-babel';

/**
 * 格式化代码 (Prettier)
 */
export const formatDocument = async (editor, language = 'json') => {
    const text = editor.getValue();
    if (!text) return;
    try {
        const formatted = await prettier.format(text, {
            parser: language === 'json' ? 'json-stringify' : 'babel',
            plugins: [parserBabel],
            printWidth: 80,
            tabWidth: 2,
        });
        editor.setValue(formatted);
    } catch (e) {
        console.error('Format failed:', e);
    }
};

/**
 * JSON 压缩
 */
export const compressJson = (editor) => {
    let e = editor.getValue();
    if (!e) return;
    try {
        e = JSON.stringify(JSON.parse(e));
    } catch (err) {
        e = e.split("\n").join(" ").replace(/\s+/g, "");
    }
    editor.setValue(e);
};

/**
 * JSON 转义 (Type: 2)
 */
export const escapeJson = (editor) => {
    let e = editor.getValue();
    if (!e) return;
    e = e.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    editor.setValue(e);
};

/**
 * JSON 去转义 (Type: 4)
 */
export const unescapeJson = (editor) => {
    let e = editor.getValue();
    if (!e) return;
    e = e.replace(/\\\\/g, "\\").replace(/\\"/g, '"');
    editor.setValue(e);
};

/**
 * Unicode 互转
 */
export const unicode2Ch = (editor) => {
    let t = editor.getValue();
    const res = t.replace(/\\u([\d\w]{4})/gi, (match, grp) => {
        return String.fromCharCode(parseInt(grp, 16));
    });
    editor.setValue(res);
};

export const ch2Unicode = (editor) => {
    let t = editor.getValue();
    const res = t.replace(/[\u4e00-\u9fa5]/g, (s) => {
        return "\\u" + s.charCodeAt(0).toString(16);
    });
    editor.setValue(res);
};
