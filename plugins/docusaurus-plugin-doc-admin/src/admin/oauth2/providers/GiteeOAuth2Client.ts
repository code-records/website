import {OAuth2Client} from '../OAuth2Client';
import type {
    AdminCommitAction,
    AdminFileByPath,
    AdminFileContent,
    AdminPipeline,
    AdminPipelineJob,
    AdminTreeItem,
    AdminUser,
    OAuth2TokenResponse,
    RepositoryOAuth2ClientConfig,
} from '../OAuth2Client';

const GITEE_REAL_DOMAIN = 'https://gitee.com';
const API_BASE_URL = `${GITEE_REAL_DOMAIN}/api/v5`;
const TOKEN_KEY = 'gitee_oauth_token';
const DEFAULT_SCOPE = 'user_info projects';

export type GiteeOAuth2Config = Omit<RepositoryOAuth2ClientConfig, 'clientSecret' | 'scope'> & {
    clientSecret: string;
};

type RequestConfig = {
    url: string;
    method?: string;
    params?: Record<string, unknown>;
    data?: Record<string, unknown>;
    headers?: Record<string, string>;
    form?: boolean;
    auth?: boolean;
    responseType?: 'arraybuffer';
};

function appendParams(url: string, params?: Record<string, unknown>): string {
    if (!params) return url;

    const urlParams = new URLSearchParams();
    Object.keys(params).forEach((key) => {
        const value = params[key];
        if (value === undefined || value === null || value === '') return;
        urlParams.append(key, String(value));
    });

    const queryString = urlParams.toString();
    if (!queryString) return url;
    return url + (url.includes('?') ? '&' : '?') + queryString;
}

async function requestToken(data: Record<string, string>): Promise<OAuth2TokenResponse> {
    const response = await fetch(`${GITEE_REAL_DOMAIN}/oauth/token`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: new URLSearchParams(data).toString(),
    });

    if (!response.ok) {
        const error = new Error(`Gitee OAuth token request failed with status code ${response.status}`);
        (error as Error & {response?: unknown}).response = {
            status: response.status,
            statusText: response.statusText,
            data: await response.text().catch(() => null),
        };
        throw error;
    }

    return response.json();
}

function cleanPath(path = ''): string {
    return String(path).replace(/^\.?\//, '').replace(/\\/g, '/');
}

function encodeGitPath(path = ''): string {
    return cleanPath(path).split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function base64ToBytes(content = ''): Uint8Array {
    const binary = window.atob(String(content).replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function base64ToText(content = ''): string {
    return new TextDecoder('utf-8').decode(base64ToBytes(content));
}

function textToBase64(content = ''): string {
    const bytes = new TextEncoder().encode(content);
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return window.btoa(binary);
}

function normalizeContentsItem(item: Record<string, any>): AdminTreeItem {
    const isDir = item.type === 'dir' || item.type === 'tree';
    return {
        ...item,
        id: item.sha,
        sha: item.sha,
        name: item.name,
        path: item.path,
        type: isDir ? 'tree' : 'blob',
    };
}

function dirAndFileSort<T extends Record<string, any>>(arr: T[], [key, value, value2]: string[], [key2]: string[]): T[] {
    arr.sort((a, b) => {
        if (a[key] === value && b[key] === value2) return -1;
        if (a[key] === value2 && b[key] === value) return 1;

        const aName = String(a[key2] || '');
        const bName = String(b[key2] || '');
        if (aName.startsWith('_') && !bName.startsWith('_')) return -1;
        if (!aName.startsWith('_') && bName.startsWith('_')) return 1;
        return aName.localeCompare(bName);
    });
    return arr;
}

export class GiteeOAuth2Client extends OAuth2Client<GiteeOAuth2Config> {
    readonly id = 'gitee' as const;
    readonly name = 'Gitee';
    protected readonly tokenKey = TOKEN_KEY;

    protected validateConfig(config: GiteeOAuth2Config): void {
        if (!config.owner || !config.repo || !config.ref || !config.clientId || !config.clientSecret) {
            throw new Error('Gitee OAuth config is missing. Please set gitee.owner, gitee.repo, gitee.ref, gitee.clientId and gitee.clientSecret.');
        }
    }

    private repoPath(path = ''): string {
        const config = this.getConfig();
        const encoded = encodeGitPath(path);
        return encoded
            ? `/repos/${config.owner}/${config.repo}/contents/${encoded}`
            : `/repos/${config.owner}/${config.repo}/contents`;
    }

    private async request(config: RequestConfig): Promise<any> {
        const method = (config.method || 'get').toUpperCase();
        const auth = config.auth !== false;
        const oauthToken = auth ? this.getAccessToken() : null;
        const params = {...(config.params || {})};
        let data = config.data ? {...config.data} : undefined;

        if (oauthToken) {
            if (method === 'GET' || method === 'DELETE') {
                params.access_token = oauthToken;
            } else {
                data = {access_token: oauthToken, ...(data || {})};
            }
        }

        let url = config.url.startsWith('http') ? config.url : `${API_BASE_URL}${config.url}`;
        url = appendParams(url, params);

        const headers: Record<string, string> = {
            Accept: 'application/json',
            ...(config.headers || {}),
        };

        let body: string | undefined;
        if (data) {
            if (config.form) {
                headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
                body = new URLSearchParams(data as Record<string, string>).toString();
            } else {
                headers['Content-Type'] = 'application/json';
                body = JSON.stringify(data);
            }
        }

        const response = await fetch(url, {method, headers, body});

        if (response.status === 401) {
            console.error('[Gitee API] 401 Unauthorized - Token may be expired or invalid');
        }

        if (!response.ok) {
            const error = new Error(`Request failed with status code ${response.status}`);
            (error as Error & {response?: unknown}).response = {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                data: await response.text().then((text) => {
                    try {
                        return JSON.parse(text);
                    } catch {
                        return text;
                    }
                }).catch(() => null),
            };
            throw error;
        }

        if (response.status === 204) return null;
        if (config.responseType === 'arraybuffer') return response.arrayBuffer();

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) return response.json();
        return response.text();
    }

    private async getContents(path = '', options: {ref?: string; auth?: boolean} = {}): Promise<any> {
        const config = this.getConfig();
        return this.request({
            url: this.repoPath(path),
            method: 'get',
            params: {ref: options.ref || config.ref},
            auth: options.auth,
        });
    }

    private async fetchContentsTree(path = '', recursive = false, options: {ref?: string; auth?: boolean} = {}): Promise<AdminTreeItem[]> {
        const res = await this.getContents(path, options);
        const entries = Array.isArray(res) ? res : [res];
        let items = entries.map(normalizeContentsItem);

        if (recursive) {
            for (const entry of entries) {
                if (entry.type === 'dir' || entry.type === 'tree') {
                    const childItems = await this.fetchContentsTree(entry.path, true, options);
                    items = items.concat(childItems);
                }
            }
        }

        return items;
    }

    private normalizeCommitAction(action: AdminCommitAction): Record<string, unknown> {
        const actionType = action.action;
        const path = action.file_path || action.path;

        if (!path) {
            throw new Error(`Missing path for Gitee action: ${actionType}`);
        }

        if (!['create', 'update', 'delete', 'move', 'chmod'].includes(actionType)) {
            throw new Error(`Unsupported Gitee action: ${actionType}`);
        }

        const normalized: Record<string, unknown> = {
            action: actionType,
            path,
        };

        if (action.previous_path) normalized.previous_path = action.previous_path;
        if (action.content !== undefined) normalized.content = action.content;
        if (action.encoding) normalized.encoding = action.encoding;
        if (action.last_commit_id) normalized.last_commit_id = action.last_commit_id;
        if (action.execute_filemode !== undefined) normalized.execute_filemode = action.execute_filemode;

        return normalized;
    }

    redirectToAuth(): void {
        const config = this.getConfig();
        const params = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: this.getRedirectUri(),
            response_type: 'code',
            scope: DEFAULT_SCOPE,
        });

        window.location.href = `${GITEE_REAL_DOMAIN}/oauth/authorize?${params.toString()}`;
    }

    async handleCallback(): Promise<string | null> {
        const config = this.getConfig();
        const params = new URLSearchParams(window.location.search.substring(1));
        const code = params.get('code');
        if (!code) return null;

        const data = await requestToken({
            grant_type: 'authorization_code',
            code,
            client_id: config.clientId,
            redirect_uri: this.getRedirectUri(),
            client_secret: config.clientSecret,
        });
        const token = data.access_token || null;
        if (token) {
            this.storeToken(token, data.refresh_token, data.expires_in);
        }

        ['code', 'state'].forEach((key) => params.delete(key));
        const queryString = params.toString();
        window.history.replaceState({}, document.title, window.location.pathname + (queryString ? `?${queryString}` : ''));

        return token;
    }

    getUser(): Promise<AdminUser> {
        return this.request({url: '/user', method: 'get'}).then((user: AdminUser) => ({
            ...user,
            username: user.username || user.login || user.name,
        }));
    }

    async getFileByPath(path = 'README.md'): Promise<AdminFileByPath> {
        const res = await this.getContents(path);
        if (Array.isArray(res) || res.type === 'dir') {
            throw new Error(`File not found: ${path}`);
        }

        return {
            ...res,
            content: base64ToText(res.content || ''),
            blob_id: res.sha,
            sha: res.sha,
        };
    }

    getDirectoryContents(path = 'docs'): Promise<AdminTreeItem[]> {
        return this.fetchContentsTree(path).then((allItems) => {
            const mapped = allItems.map((item) => ({
                ...item,
                type: item.type === 'tree' ? 'dir' : 'file',
            }));
            return dirAndFileSort(mapped, ['type', 'dir', 'file'], ['path']);
        });
    }

    getTreeRecursive(path = ''): Promise<AdminTreeItem[]> {
        return this.fetchContentsTree(path, true).then((allItems) => {
            const mapped = allItems.map((item) => ({
                ...item,
                type: item.type === 'tree' ? 'dir' : 'file',
            }));
            return dirAndFileSort(mapped, ['type', 'dir', 'file'], ['path']);
        });
    }

    getTree(path = ''): Promise<AdminTreeItem[]> {
        return this.fetchContentsTree(path).then((allItems) => {
            const mapped = allItems.map((item) => ({
                ...item,
                type: item.type === 'tree' ? 'tree' : 'blob',
            }));
            return dirAndFileSort(mapped, ['type', 'tree', 'blob'], ['path']);
        });
    }

    getFileContent(fileSha: string): Promise<AdminFileContent> {
        if (!fileSha) {
            return Promise.reject(new Error('Missing fileSha for Blob access'));
        }

        const config = this.getConfig();
        return this.request({
            url: `/repos/${config.owner}/${config.repo}/git/blobs/${fileSha}`,
            method: 'get',
        }).then((res) => ({
            ...res,
            content: base64ToText(res.content || ''),
            raw: base64ToBytes(res.content || ''),
        }));
    }

    async getFileRaw(fileSha: string): Promise<Uint8Array> {
        const res = await this.getFileContent(fileSha);
        return res.raw || new Uint8Array();
    }

    async createFile(path: string, content = '', message = 'Create file'): Promise<unknown> {
        const config = this.getConfig();
        return this.request({
            url: this.repoPath(path),
            method: 'post',
            form: true,
            data: {
                content: textToBase64(content),
                message,
                branch: config.ref,
            },
        });
    }

    async updateFile(path: string, content: string, message = 'Update from MDX Editor'): Promise<unknown> {
        const config = this.getConfig();
        const file = await this.getFileByPath(path);
        return this.request({
            url: this.repoPath(path),
            method: 'put',
            form: true,
            data: {
                content: textToBase64(content),
                sha: file.sha,
                message,
                branch: config.ref,
            },
        });
    }

    async deleteFile(path: string, message = 'Delete file'): Promise<unknown> {
        const config = this.getConfig();
        const file = await this.getFileByPath(path);
        return this.request({
            url: this.repoPath(path),
            method: 'delete',
            params: {
                sha: file.sha,
                message,
                branch: config.ref,
            },
        });
    }

    async commitBatch(actions: AdminCommitAction[], message = 'Batch update from MDX Editor'): Promise<unknown> {
        if (!Array.isArray(actions) || actions.length === 0) {
            return null;
        }

        const config = this.getConfig();
        return this.request({
            url: `/repos/${config.owner}/${config.repo}/commits`,
            method: 'post',
            data: {
                branch: config.ref,
                message,
                actions: actions.map((action) => this.normalizeCommitAction(action)),
            },
        });
    }

    async getLatestPipeline(): Promise<AdminPipeline | null> {
        return null;
    }

    getPipelineJobs(): Promise<AdminPipelineJob[]> {
        return Promise.resolve([]);
    }

    async deleteDirectory(path: string, message = 'Delete directory'): Promise<unknown> {
        const tree = await this.fetchContentsTree(path, true);
        const actions = tree
            .filter((item) => item.type === 'blob')
            .map((item) => ({action: 'delete', file_path: item.path}));

        if (actions.length === 0) return undefined;
        return this.commitBatch(actions, message);
    }

    async renameItem(oldPath: string, newPath: string, isDir = false, message = 'Rename item'): Promise<unknown> {
        if (!isDir) {
            return this.commitBatch([
                {action: 'move', previous_path: oldPath, file_path: newPath},
            ], `${message}: ${oldPath} -> ${newPath}`);
        }

        const tree = await this.fetchContentsTree(oldPath, true);
        const actions = tree
            .filter((item) => item.type === 'blob')
            .map((item) => ({
                action: 'move',
                previous_path: item.path,
                file_path: item.path.replace(oldPath, newPath),
            }));

        if (actions.length === 0) return undefined;
        return this.commitBatch(actions, `${message} (Dir): ${oldPath} -> ${newPath}`);
    }

    async readFileReadonly(path: string): Promise<string | null> {
        try {
            const config = this.getConfig();
            const url = `/repos/${config.owner}/${config.repo}/raw/${encodeGitPath(path)}`;
            return await this.request({url, method: 'get', params: {ref: config.ref}, auth: false});
        } catch (error) {
            const response = (error as {response?: {status?: number}}).response;
            if (response?.status === 404) return null;
            throw new Error(`Gitee readonly read failed: ${response?.status || (error as Error).message}`);
        }
    }

    async readTreeReadonly(path = '', recursive = false): Promise<string[] | null> {
        try {
            const items = await this.fetchContentsTree(path, recursive, {auth: false});
            return items.map((item) => item.path);
        } catch (error) {
            const response = (error as {response?: {status?: number}}).response;
            if (response?.status === 404) return null;
            throw new Error(`Gitee readonly tree failed: ${response?.status || (error as Error).message}`);
        }
    }
}

export {GITEE_REAL_DOMAIN, TOKEN_KEY};
