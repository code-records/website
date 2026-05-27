import { FileTool, type FileToolInput, type FileToolOutput } from '../FileTool';
import type { ToolRunContext } from '../tool/Tool';

/**
 * 浏览器端 HTML5 原生文件系统工具。
 *
 * 继承自 FileTool，完全基于浏览器原生 File System Access API 实现。
 * 依靠外部授权传入的 FileSystemDirectoryHandle 句柄，提供完全沙箱化的文件读取与写入服务。
 */
export class BrowserFileTool extends FileTool {
    /**
     * @param rootHandle 外部（如 App.jsx）通过 window.showDirectoryPicker() 授权获取的根目录句柄
     */
    constructor(private readonly rootHandle: FileSystemDirectoryHandle) {
        super();
    }

    protected async executeFileOperation(input: FileToolInput, _context: ToolRunContext): Promise<FileToolOutput> {
        const { operation, path: pathStr, content } = input;

        // 统一处理斜杠，避免跨系统路径解析差异
        const normalizedPath = this.normalizePath(pathStr);

        switch (operation) {
            case 'read': {
                const fileContent = await this.readFileText(normalizedPath);
                return {
                    operation: 'read',
                    path: pathStr,
                    content: fileContent
                };
            }

            case 'write': {
                if (content === undefined) {
                    throw new Error(`[BrowserFileTool] 写入操作必须提供 'content' 字段内容`);
                }
                await this.writeFileText(normalizedPath, content);
                return {
                    operation: 'write',
                    path: pathStr
                };
            }

            case 'exists': {
                const isExist = await this.checkExists(normalizedPath);
                return {
                    operation: 'exists',
                    path: pathStr,
                    exists: isExist
                };
            }

            case 'delete': {
                await this.deleteEntry(normalizedPath);
                return {
                    operation: 'delete',
                    path: pathStr
                };
            }

            case 'list': {
                const files = await this.listDirectory(normalizedPath);
                return {
                    operation: 'list',
                    path: pathStr,
                    content: files.join('\n')
                };
            }

            case 'stat': {
                const info = await this.statEntry(normalizedPath);
                return {
                    operation: 'stat',
                    path: pathStr,
                    size: info.size
                };
            }

            default:
                throw new Error(`[BrowserFileTool] 暂不支持操作: ${operation}`);
        }
    }

    // ─── 核心句柄寻址辅助 ────────────────────────────────────────────────────────

    private normalizePath(pathStr: string): string {
        const parts = pathStr
            .replace(/\\/g, '/')
            .split('/')
            .map(part => part.trim())
            .filter(part => part.length > 0 && part !== '.');

        if (parts.some(part => part === '..')) {
            throw new Error(`不允许访问工作区之外的路径: ${pathStr}`);
        }

        return parts.join('/');
    }

    /**
     * 按路径向下层层查找，返回目标父级目录句柄。
     */
    private async getParentDirectoryHandle(parts: string[]): Promise<FileSystemDirectoryHandle> {
        let handle = this.rootHandle;
        for (const part of parts) {
            try {
                handle = await handle.getDirectoryHandle(part);
            } catch (e: any) {
                if (e.name === 'NotFoundError') {
                    throw new Error(`目录路径不存在: ${parts.join('/')}`);
                }
                throw e;
            }
        }
        return handle;
    }

    /**
     * 根据相对路径获取文件句柄 FileSystemFileHandle。
     */
    private async getFileHandle(normalizedPath: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> {
        const parts = normalizedPath.split('/').filter(Boolean);
        if (parts.length === 0) {
            throw new Error(`无效的文件路径`);
        }
        const fileName = parts.pop()!;
        const parentDir = await this.getParentDirectoryHandle(parts);
        try {
            return await parentDir.getFileHandle(fileName, options);
        } catch (e: any) {
            if (e.name === 'NotFoundError') {
                throw new Error(`找不到目标文件: ${normalizedPath}`);
            }
            throw e;
        }
    }

    /**
     * 根据相对路径获取目录句柄 FileSystemDirectoryHandle。
     */
    private async getDirectoryHandle(normalizedPath: string, options?: FileSystemGetDirectoryOptions): Promise<FileSystemDirectoryHandle> {
        const parts = normalizedPath.split('/').filter(Boolean);
        return this.getParentDirectoryHandle(parts);
    }

    // ─── 核心文件接口操作 ────────────────────────────────────────────────────────

    /**
     * 异步读取文本。
     */
    private async readFileText(normalizedPath: string): Promise<string> {
        const fileHandle = await this.getFileHandle(normalizedPath);
        const file = await fileHandle.getFile();
        return file.text();
    }

    /**
     * 写入或新建文本文件。
     */
    private async writeFileText(normalizedPath: string, content: string): Promise<void> {
        const fileHandle = await this.getFileHandle(normalizedPath, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
    }

    /**
     * 判断文件或目录是否存在。
     */
    private async checkExists(normalizedPath: string): Promise<boolean> {
        if (!normalizedPath) return true;
        const parts = normalizedPath.split('/').filter(Boolean);
        const name = parts.pop()!;
        try {
            const parentDir = await this.getParentDirectoryHandle(parts);
            try {
                await parentDir.getFileHandle(name);
                return true;
            } catch {
                await parentDir.getDirectoryHandle(name);
                return true;
            }
        } catch {
            return false;
        }
    }

    /**
     * 删除文件或递归删除目录。
     */
    private async deleteEntry(normalizedPath: string): Promise<void> {
        const parts = normalizedPath.split('/').filter(Boolean);
        if (parts.length === 0) {
            throw new Error(`不允许直接删除根目录句柄`);
        }
        const name = parts.pop()!;
        const parentDir = await this.getParentDirectoryHandle(parts);
        try {
            await parentDir.removeEntry(name, { recursive: true });
        } catch (e: any) {
            if (e.name === 'NotFoundError') {
                throw new Error(`找不到删除的目标: ${normalizedPath}`);
            }
            throw e;
        }
    }

    /**
     * 浅层列出目录下的内容（只读一层）。
     */
    private async listDirectory(normalizedPath: string): Promise<string[]> {
        const dirHandle = await this.getDirectoryHandle(normalizedPath);
        const entries: string[] = [];

        // 强行规避 TS 类型检查中对 FileSystemDirectoryHandle async iterator 的报错问题
        for await (const [name, handle] of (dirHandle as any).entries()) {
            entries.push(`${name} [${handle.kind}]`);
        }

        return entries;
    }

    /**
     * 获取文件属性（大小等）。
     */
    private async statEntry(normalizedPath: string): Promise<{ size: number }> {
        const fileHandle = await this.getFileHandle(normalizedPath);
        const file = await fileHandle.getFile();
        return { size: file.size };
    }
}
