/**
 * ─── 浏览器文件系统授权与持久化连接助手 (browserFileSystemHelper) ───
 * 
 * 专门用于在浏览器中处理 File System Access API (FileSystemDirectoryHandle) 的一键授权获取、
 * IndexedDB 零依赖持久化静默加载、以及权限暂时收回后的“一键确认恢复”逻辑。
 * 
 * 💡 极简对称接口使用示范 (React 架构一键集成)：
 * 
 * ```typescript
 * import React, { useEffect, useState } from 'react';
 * import { BrowserFileTool } from './BrowserFileTool';
 * import { 
 *     queryFileSystemDirectoryHandle, 
 *     requestFileSystemDirectoryHandle, 
 *     disposeFileSystemDirectoryHandle 
 * } from './browserFileSystemHelper';
 * 
 * export function WorkspaceConnector() {
 *     const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
 * 
 *     // 1. 【查询本地已授权的目录句柄】：页面初始化时自动静默重连昨日工作区，零感知秒开
 *     useEffect(() => {
 *         queryFileSystemDirectoryHandle().then(savedHandle => {
 *             if (savedHandle) {
 *                 setHandle(savedHandle);
 *                 bindToAgent(savedHandle);
 *             }
 *         });
 *     }, []);
 * 
 *     // 2. 【申请授权目录句柄】：用户点击按钮时调用。
 *     //    全自动判定：老用户一键快速恢复授权（顶部弹原生确认框）；新用户一键调起文件夹选择器。
 *     const handleConnect = async () => {
 *         try {
 *             const activeHandle = await requestFileSystemDirectoryHandle();
 *             setHandle(activeHandle);
 *             bindToAgent(activeHandle);
 *         } catch (err) {
 *             console.log('连接中断或用户取消了授权');
 *         }
 *     };
 * 
 *     // 3. 【销毁/释放目录句柄】：退出当前工作区并擦除 IndexedDB 中的物理句柄缓存
 *     const handleDisconnect = async () => {
 *         await disposeFileSystemDirectoryHandle();
 *         setHandle(null);
 *     };
 * 
 *     function bindToAgent(activeHandle: FileSystemDirectoryHandle) {
 *         const browserFileTool = new BrowserFileTool(activeHandle);
 *         console.log('BrowserFileTool 装配就绪：', browserFileTool);
 *     }
 * 
 *     return (
 *         <div>
 *             {!handle ? (
 *                 <button onClick={handleConnect}>📂 连接本地工作区</button>
 *             ) : (
 *                 <div>
 *                     <p>🟢 已连接本地目录: {handle.name}</p>
 *                     <button onClick={handleDisconnect}>🔌 断开连接</button>
 *                 </div>
 *             )}
 *         </div>
 *     );
 * }
 * ```
 */

// ─── 实验性 File System Access API 的局部 TypeScript 类型扩展 ───────

interface ExtendedWindow extends Window {
    showDirectoryPicker(options?: any): Promise<FileSystemDirectoryHandle>;
}

interface ExtendedFileSystemDirectoryHandle extends FileSystemDirectoryHandle {
    queryPermission(descriptor?: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(descriptor?: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

// ─── 原生零依赖 IndexedDB 轻量键值存储 ──────────────────────────

const DB_NAME = 'BrowserFileTool_WorkspaceDB';
const STORE_NAME = 'workspace_handles';
const KEY_HANDLE = 'active_root_handle';

function getDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * 原生将句柄存储至 IndexedDB。
 */
async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(handle, KEY_HANDLE);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * 原生从 IndexedDB 中读取句柄。
 */
async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(KEY_HANDLE);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * 原生从 IndexedDB 中删除句柄。
 */
async function deleteHandle(): Promise<void> {
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(KEY_HANDLE);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// ─── 核心对外三大轻量对称方法 ───────────────────────────────────

export interface WorkspacePermissionOptions {
    /** 申请的读写模式，默认为 'readwrite' */
    mode?: 'read' | 'readwrite';
}

/**
 * 1. 【查询本地已授权的目录句柄】：在网页刚加载（如 React useEffect）时静默调用。
 * 尝试无感恢复昨日的工作区。
 * - 若读取到历史句柄且**当前依然拥有访问权限**，直接返回该句柄，实现零感知秒开。
 * - 否则（没读到，或者权限已被浏览器回收），返回 `null`，保持安静不骚扰用户。
 * 
 * @param options 权限读写模式，默认 'readwrite'
 */
export async function queryFileSystemDirectoryHandle(
    options?: WorkspacePermissionOptions
): Promise<FileSystemDirectoryHandle | null> {
    if (typeof window === 'undefined') return null;

    try {
        const handle = await loadHandle();
        if (!handle) return null;

        const mode = options?.mode || 'readwrite';
        // 静默查询当前该句柄是否已拥有读写权限
        const permission = await (handle as unknown as ExtendedFileSystemDirectoryHandle).queryPermission({ mode });

        if (permission === 'granted') {
            return handle;
        }
        return null;
    } catch (error) {
        console.warn('[browserFileSystemHelper] 静默查询工作区连接异常:', error);
        return null;
    }
}

/**
 * 2. 【申请授权目录句柄】：在用户点击“连接/打开工作区”按钮时调用。
 * 全自动兼容新老用户体验：
 * - 优先重用昨日句柄：尝试重新获取读写授权（瞬间弹出浏览器地址栏顶部轻量原生确认框，无需重新翻找选择文件夹）。
 * - 降级调起原生选择器：如果没有昨日历史记录，或者快速恢复被用户拒绝，则自动弹出系统级文件选择框，让用户选择新文件夹，并自动持久化。
 * 
 * @param options 目录选项及权限读写模式
 * @returns 授权激活的 FileSystemDirectoryHandle 根目录句柄
 */
export async function requestFileSystemDirectoryHandle(
    options?: any
): Promise<FileSystemDirectoryHandle> {
    if (typeof window === 'undefined') {
        throw new Error('[browserFileSystemHelper] 当前运行环境不支持浏览器 API');
    }

    const { mode = 'readwrite', ...pickerOpts } = options || {};

    try {
        // A. 尝试从历史中唤醒快速授权
        const savedHandle = await loadHandle();
        if (savedHandle) {
            const state = await (savedHandle as unknown as ExtendedFileSystemDirectoryHandle).requestPermission({ mode });
            if (state === 'granted') {
                return savedHandle;
            }
        }
    } catch (error) {
        console.warn('[browserFileSystemHelper] 尝试通过历史句柄快速重授权失败，将降级至重新选择:', error);
    }

    // B. 全新访问，或者快速唤醒失败，调起原生选择器（必须在用户点击手势内触发）
    const newHandle = await (window as unknown as ExtendedWindow).showDirectoryPicker({
        mode,
        ...pickerOpts
    });

    // 自动将获得的句柄写入 IndexedDB 备用
    await saveHandle(newHandle);
    return newHandle;
}

/**
 * 3. 【销毁/释放目录句柄】：在用户点击“退出连接”或“清除缓存”时调用。
 * 彻底擦除 IndexedDB 中的历史句柄缓存，断开连接状态。
 */
export async function disposeFileSystemDirectoryHandle(): Promise<void> {
    try {
        await deleteHandle();
    } catch (error) {
        console.error('[browserFileSystemHelper] 清理工作区句柄时发生异常:', error);
    }
}
