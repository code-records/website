// ==================== 配置 ====================
// 真实的 GitLab 域名，仅用于 OAuth 重定向跳转
const GITLAB_REAL_DOMAIN = 'http://gitlab.sh.com';

/**
 * API 基础路径
 * 使用当前域名 (window.location.origin) 作为基地址
 * 这样浏览器会认为请求是同源的，请求会被本地 Webpack 插件或线上 Nginx 拦截并代理
 */
const CURRENT_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';
const API_BASE_URL = `${CURRENT_ORIGIN}/gitlab-oauth/api/v4`;

// OAuth 配置
export const OAUTH_CONFIG = {
    clientId: 'de5c1c3c81cce4bb4c4da2fe9bd495628b22b20296f857461ae8fd5d13e6a807',
    clientSecret: '12147f754a55df3d2adac52d102b18968247bfbc581418ff27a9fc4bce2c7d67',
    get redirectUri() { return `${window.location.origin}/admin` },
    scope: 'api'
};

async function request(config) {
    let url = config.url.startsWith('http') ? config.url : `${API_BASE_URL}${config.url}`;

    // 处理 params -> Query String
    if (config.params) {
        const urlParams = new URLSearchParams();
        for (const key in config.params) {
            const val = config.params[key];
            if (val !== undefined && val !== null) {
                urlParams.append(key, val);
            }
        }
        const queryString = urlParams.toString();
        if (queryString) {
            url += (url.includes('?') ? '&' : '?') + queryString;
        }
    }

    const headers = {
        'Content-Type': 'application/json',
        ...config.headers
    };

    const oauthToken = typeof localStorage !== 'undefined'
        ? localStorage.getItem('gitlab_oauth_token')
        : null;
    if (oauthToken) {
        headers['Authorization'] = `Bearer ${oauthToken}`;
    }

    const response = await fetch(url, {
        method: config.method?.toUpperCase() || 'GET',
        headers: headers,
        body: config.data ? JSON.stringify(config.data) : undefined
    });

    // 响应处理
    if (response.status === 401) {
        console.error('[GitLab API] 401 Unauthorized - Token may be expired or invalid');
    }

    if (!response.ok) {
        // 模拟 Axios 错误结构，便于 Catch 块处理
        const error = new Error(`Request failed with status code ${response.status}`);
        error.response = {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
        };
        try {
            const text = await response.text();
            try {
                error.response.data = JSON.parse(text);
            } catch (e) {
                error.response.data = text;
            }
        } catch (e) {
            error.response.data = null;
        }
        throw error;
    }

    // 204 No Content
    if (response.status === 204) {
        return null;
    }

    // 处理不同的响应类型
    if (config.responseType === 'arraybuffer') {
        return await response.arrayBuffer();
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return await response.json();
    }
    return await response.text();
}

/**
 * 通过完整路径获取文件内容 (Tree 遍历递归加载模式)
 * 
 * ⚠️ 重要说明：
 * 此方法主要用于解决旧版 GitLab (如 11.x) API 的已知限制：
 * 1. 直接请求 /repository/files/:path 可能由于路径编码 (如 `.`, `/`) 导致意外的 404。
 * 2. 此方法性能较差（多次请求），仅应在初始化 sidebars.json 或 secrets.json 时使用。
 * 
 * 对于普通的 Markdown 文档点击加载，请始终优先使用 getFileContent (Blob/Raw 模式)。
 * 
 * @param {string} path 完整文件路径，如 'admin/_config/secrets.json'
 * @returns {Promise<{content: string, blob_id?: string}>}
 */
export async function getFileByPath(path = 'README.md') {
    // 分割路径：目录 + 文件名
    const lastSlash = path.lastIndexOf('/');
    const dirPath = lastSlash > 0 ? path.substring(0, lastSlash) : '';
    const fileName = lastSlash > 0 ? path.substring(lastSlash + 1) : path;

    // 获取目录树
    const tree = await request({
        url: `/projects/${projectID}/repository/tree`,
        method: 'get',
        params: { ref, path: dirPath }
    });

    // 在目录中查找目标文件
    const file = tree.find(item => item.name === fileName && item.type === 'blob');
    if (!file) {
        throw new Error(`文件未找到: ${path}`);
    }

    // 通过 SHA 获取文件内容
    const res = await request({
        url: `/projects/${projectID}/repository/blobs/${file.id}/raw`,
        method: 'get',
    });

    const content = typeof res === 'string' ? res : JSON.stringify(res, null, 2);
    return { content, blob_id: file.id };
}

/**
 * OAuth 相关流程
 */
export function redirectToGitLabAuth() {
    const authUrl = `${GITLAB_REAL_DOMAIN}/oauth/authorize?client_id=${OAUTH_CONFIG.clientId}&redirect_uri=${encodeURIComponent(OAUTH_CONFIG.redirectUri)}&response_type=token&scope=${encodeURIComponent(OAUTH_CONFIG.scope)}`;
    window.location.href = authUrl;
}

/**
 * 处理 OAuth 回调，从 URL Hash 中提取 access_token (隐式模式)
 */
export function handleOAuthCallback() {
    const hash = window.location.hash;
    if (hash && hash.includes('access_token=')) {
        const params = new URLSearchParams(hash.substring(1));
        const token = params.get('access_token');
        if (token) {
            localStorage.setItem('gitlab_oauth_token', token);
            // 清理 hash，保持 URL 干净
            window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
            return token;
        }
    }
    return null;
}

export function gitlabLogout() {
    localStorage.removeItem('gitlab_oauth_token');
    window.location.reload();
}

export function isOAuthLoggedIn() {
    if (typeof localStorage === 'undefined') return false;
    return !!localStorage.getItem('gitlab_oauth_token');
}

/**
 * 企业 业务接口 (移植自 gitlab_api.js)
 */
export const projectID = 'xxx';
export const ref = 'master';

// 用户详情
export function getUser() {
    return request({ url: '/user', method: 'get' });
}

// 内部通用 Tree 获取函数（处理分页）
async function fetchAllTreeItems(path, recursive = false) {
    let allItems = [];
    let page = 1;
    const perPage = 100;

    while (true) {
        const res = await request({
            url: `/projects/${projectID}/repository/tree`,
            method: 'get',
            params: { ref, path: path, per_page: perPage, page: page, recursive }
        });

        if (!Array.isArray(res)) break;
        allItems = [...allItems, ...res];

        if (res.length < perPage) break;
        page++;
    }
    return allItems;
}

// 获取目录内容
export function getDirectoryContents(path = 'docs') {
    return fetchAllTreeItems(path).then(allItems => {
        const mapped = allItems.map(item => ({
            ...item,
            path: item.path,
            name: item.name,
            sha: item.id,
            type: item.type === 'tree' ? 'dir' : 'file'
        }));
        return dirAndFileSort(mapped, ['type', 'dir', 'file'], ['path']);
    });
}

// 获取全量目录树 (递归加载所有)
export function getTreeRecursive(path) {
    return fetchAllTreeItems(path, true).then(allItems => {
        const mapped = allItems.map(item => ({
            ...item,
            path: item.path,
            name: item.name,
            sha: item.id,
            type: item.type === 'tree' ? 'dir' : 'file'
        }));
        // 这里的排序是全局排序，对于树构建来说可能不是必需的，但保持一致性
        return dirAndFileSort(mapped, ['type', 'dir', 'file'], ['path']);
    });
}

// 获取目录树 (递归加载)
export function getTree(path) {
    return fetchAllTreeItems(path).then(allItems => {
        const mapped = allItems.map(item => ({
            ...item,
            path: item.path,
            name: item.name,
            sha: item.id,
            type: item.type === 'tree' ? 'tree' : 'blob'
        }));
        return dirAndFileSort(mapped, ['type', 'tree', 'blob'], ['path']);
    });
}

// 获取文件内容处理 bytes/uint8array 兼容
const getArrayBuffer = async (url) => {
    return await request({ url, responseType: 'arraybuffer' });
};

/**
 * 获取文件内容 (仅限 SHA 访问)
 * 拒绝过度防御：不再提供路径回退逻辑。
 * 如果没有 SHA，调用者应先通过 Tree API 获取对应的 SHA。
 * 
 * @param {string} fileSha 文件的 Blob SHA
 * @returns {Promise<{content: string, raw?: Uint8Array}>}
 */
export function getFileContent(fileSha) {
    if (!fileSha) {
        return Promise.reject('Missing fileSha for Blob access');
    }
    // 注意：如果是扩展需要 Uint8Array，我们可以提供一个 raw 字段
    return request({
        url: `/projects/${projectID}/repository/blobs/${fileSha}/raw`,
        method: 'get',
    }).then(async res => {
        // 正常返回 string
        return { content: typeof res === 'string' ? res : JSON.stringify(res) };
    });
}

// 新增辅助方法专门给 IDE 扩展获取 Uint8Array
export async function getFileRaw(fileSha) {
    const url = `${API_BASE_URL}/projects/${projectID}/repository/blobs/${fileSha}/raw`;
    const buffer = await getArrayBuffer(url);
    return new Uint8Array(buffer);
}

// 提交 Commit (更新文件)
export function updateFile(path, content, message = 'Update from MDX Editor') {
    return request({
        url: `/projects/${projectID}/repository/commits`,
        method: 'post',
        data: {
            branch: ref,
            commit_message: message,
            actions: [{ action: 'update', file_path: path, content: content }]
        }
    })
}

// 批量提交 Commit (多个文件操作)
// actions: [{ action: 'create'|'update'|'delete'|'move', file_path: string, content?: string, previous_path?: string }]
export function commitBatch(actions, message = 'Batch update from MDX Editor') {
    return request({
        url: `/projects/${projectID}/repository/commits`,
        method: 'post',
        data: {
            branch: ref,
            commit_message: message,
            actions: actions
        }
    })
}

// 获取文件信息 (用于冲突检测) 如果要支持参考 frontend.conf gitlab-readonly 的路径防止 %2F 被解码
// export function getFileInfo(path) {
//     return request({
//         url: `/projects/${projectID}/repository/files/${encodeURIComponent(path)}`,
//         method: 'get',
//         params: { ref }
//     });
// }

/**
 * CI/CD 相关接口
 */

// 获取最近一次 Pipeline
export async function getLatestPipeline() {
    const res = await request({
        url: `/projects/${projectID}/pipelines`,
        method: 'get',
        params: { ref, per_page: 1 }
    });
    return Array.isArray(res) && res.length > 0 ? res[0] : null;
}

// 获取 Pipeline 的 Jobs (用于进度统计)
export function getPipelineJobs(pipelineId) {
    return request({
        url: `/projects/${projectID}/pipelines/${pipelineId}/jobs`,
        method: 'get'
    });
}

// 创建文件
export function createFile(path, content = '', message = 'Create file') {
    return request({
        url: `/projects/${projectID}/repository/commits`,
        method: 'post',
        data: {
            branch: ref,
            commit_message: message,
            actions: [{ action: 'create', file_path: path, content: content }]
        }
    })
}

// 删除文件
export function deleteFile(path, message = 'Delete file') {
    return request({
        url: `/projects/${projectID}/repository/commits`,
        method: 'post',
        data: {
            branch: ref,
            commit_message: message,
            actions: [{ action: 'delete', file_path: path }]
        }
    })
}

// 删除目录 (递归删除目录下的所有内容)
export async function deleteDirectory(path, message = 'Delete directory') {
    const res = await request({
        url: `/projects/${projectID}/repository/tree`,
        method: 'get',
        params: { ref, path: path, recursive: true }
    });

    const actions = res
        .filter(item => item.type === 'blob')
        .map(item => ({
            action: 'delete',
            file_path: item.path
        }));

    if (actions.length === 0) return Promise.resolve();

    return request({
        url: `/projects/${projectID}/repository/commits`,
        method: 'post',
        data: {
            branch: ref,
            commit_message: message,
            actions: actions
        }
    });
}

// 重命名/移动文件 or 目录
export async function renameItem(oldPath, newPath, isDir = false, message = 'Rename item') {
    if (!isDir) {
        return request({
            url: `/projects/${projectID}/repository/commits`,
            method: 'post',
            data: {
                branch: ref,
                commit_message: `${message}: ${oldPath} -> ${newPath}`,
                actions: [{ action: 'move', previous_path: oldPath, file_path: newPath }]
            }
        });
    }

    const tree = await request({
        url: `/projects/${projectID}/repository/tree`,
        method: 'get',
        params: { ref, path: oldPath, recursive: true }
    });

    const actions = tree
        .filter(item => item.type === 'blob')
        .map(item => ({
            action: 'move',
            previous_path: item.path,
            file_path: item.path.replace(oldPath, newPath)
        }));

    if (actions.length === 0) return Promise.resolve();

    return request({
        url: `/projects/${projectID}/repository/commits`,
        method: 'post',
        data: {
            branch: ref,
            commit_message: `${message} (Dir): ${oldPath} -> ${newPath}`,
            actions: actions
        }
    });
}

/**
 * 内部辅助函数
 */
function dirAndFileSort(arr, [key, value, value2], [key2]) {
    arr.sort((a, b) => {
        if (a[key] === value && b[key] === value2) return -1;
        if (a[key] === value2 && b[key] === value) return 1;
        const aName = a[key2];
        const bName = b[key2];
        if (a[key2].startsWith('_') && !b[key2].startsWith('_')) return -1;
        if (!a[key2].startsWith('_') && b[key2].startsWith('_')) return 1;
        return aName.localeCompare(bName);
    });
    return arr;
}

/**
 * 公共只读读取（走 /gitlab-readonly/ 代理，nginx 注入 Private-Token，前端无需认证）
 * 适用于 AI Agent 等不需要用户登录的场景
 */
const READONLY_BASE = '/gitlab-readonly/api/v4';

export async function readFileReadonly(path) {
    const encoded = encodeURIComponent(path);
    const url = `${READONLY_BASE}/projects/${projectID}/repository/files/${encoded}/raw?ref=${ref}`;
    const res = await fetch(url);
    if (res.ok) return res.text();
    if (res.status === 404) return null;
    throw new Error(`GitLab readonly read failed: ${res.status}`);
}

export async function readTreeReadonly(path = '', recursive = false) {
    let allItems = [];
    let page = 1;
    const perPage = 1000;

    while (true) {
        const params = new URLSearchParams({ ref, per_page: perPage, page });
        if (path) params.set('path', path);
        if (recursive) params.set('recursive', 'true');

        const url = `${READONLY_BASE}/projects/${projectID}/repository/tree?${params}`;
        const res = await fetch(url);
        if (!res.ok) {
            if (res.status === 404) return null;
            throw new Error(`GitLab readonly tree failed: ${res.status}`);
        }

        const items = await res.json();
        if (!Array.isArray(items)) break;
        allItems = [...allItems, ...items];
        if (items.length < perPage) break;
        page++;
    }

    return allItems.map(item => item.path);
}