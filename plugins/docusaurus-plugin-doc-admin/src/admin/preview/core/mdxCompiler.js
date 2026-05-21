import React from 'react'
import * as runtime from 'react/jsx-runtime'
import { compile, run } from '@mdx-js/mdx'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkDirective from 'remark-directive'
import { visit } from 'unist-util-visit'
import ReactDOMServer from 'react-dom/server'
import MDXComponents from './MDXComponents'

// 支持的 admonition 类型
const ADMONITION_TYPES = ['note', 'tip', 'info', 'warning', 'danger', 'caution']

// 需要过滤掉的 Docusaurus 特有语法模式，避免 MDX 编译报错
const IGNORED_PATTERNS = [
    /\{\#[^}]+\}/g, // Docusaurus 标题 ID 语法，例如 {#pay} (支持中文/特殊字符)
]

/**
 * 自定义 remark 插件：将 :::tip 等 container directive 转换为 Admonition 组件
 */
function remarkAdmonitions() {
    return (tree) => {
        visit(tree, (node) => {
            if (
                node.type === 'containerDirective' &&
                ADMONITION_TYPES.includes(node.name)
            ) {
                // 先保存原始类型名称
                const directiveName = node.name
                const data = node.data || (node.data = {})
                // 获取自定义标题（如果有）
                const title = node.children[0]?.data?.directiveLabel
                    ? node.children.shift()
                    : null

                // 转换为 mdxJsxFlowElement (即 JSX 组件)
                node.type = 'mdxJsxFlowElement'
                node.name = 'Admonition'
                node.attributes = [
                    { type: 'mdxJsxAttribute', name: 'type', value: directiveName === 'caution' ? 'warning' : directiveName },
                ]
                if (title && title.children?.[0]?.value) {
                    node.attributes.push({
                        type: 'mdxJsxAttribute',
                        name: 'title',
                        value: title.children[0].value,
                    })
                }
            }
        })
    }
}

export const Context = React.createContext({ isMac: true })

export const mdxCompiler = async (
    jsx,
    mdx,
    isMac,
    codeTheme = '',
    raw = false
) => {
    let err = null
    let html = null
    let Content = null

    const remarkPlugins = []
    remarkPlugins.push(remarkFrontmatter)
    remarkPlugins.push(remarkGfm)
    remarkPlugins.push(remarkMath)
    remarkPlugins.push(remarkDirective)
    remarkPlugins.push(remarkAdmonitions)

    // 预处理：批量移除不支持的特殊语法
    let safeMdx = mdx
    IGNORED_PATTERNS.forEach(pattern => {
        safeMdx = safeMdx.replace(pattern, '')
    })

    try {
        // 编译 MDX 为 function body
        const compiled = await compile(safeMdx, {
            development: false,
            outputFormat: 'function-body',
            remarkPlugins,
        })

        // 运行编译后的代码
        const result = await run(String(compiled), {
            ...runtime,
            baseUrl: window.location.href,
        })
        Content = result.default

        // 渲染为静态 HTML 用于预览
        // 使用 React.createElement 替代 JSX，使该文件保持纯 JS 语法
        html = ReactDOMServer.renderToStaticMarkup(
            React.createElement('section', {
                'data-tool': 'mdx editor',
                className: codeTheme
            }, React.createElement(Content, { components: MDXComponents }))
        )
    } catch (error) {
        console.error('MDX Compilation Error:', error);
        err = {
            message: error.message || String(error),
            file: 'MDX',
        }
    }

    return {
        err,
        html,
        Content
    }
}

export function getFrontMatter(md = '') {
    const match = md.match(/^---.*\r?\n([\s\S]*?)---/)
    const frontmatter = {}
    if (match && match.length > 1) {
        const lines = match[1].split(/\r?\n/)
        lines.forEach((line) => {
            const kv = line.split(':')
            if (kv.length > 1) {
                const key = kv.shift().trim()
                const value = kv.join(':').trim()
                frontmatter[key] = value
            }
        })
    }
    return frontmatter
}
