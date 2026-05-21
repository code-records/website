export type OAuth2ProviderId = 'gitee' | 'github' | 'gitlab';

export type OAuth2ClientConfig = {
    clientId: string;
    clientSecret?: string;
    scope?: string;
    redirectUri?: string;
};

export type RepositoryOAuth2ClientConfig = OAuth2ClientConfig & {
    owner: string;
    repo: string;
    ref: string;
};

export type OAuth2TokenResponse = {
    access_token?: string;
    token_type?: string;
    expires_in?: number | string;
    refresh_token?: string;
    scope?: string;
    created_at?: number | string;
    [key: string]: unknown;
};

export type AdminUser = {
    id?: string | number;
    username?: string;
    login?: string;
    name?: string;
    [key: string]: unknown;
};

export type AdminTreeItem = {
    id?: string | number;
    sha?: string;
    name?: string;
    path: string;
    type: string;
    [key: string]: unknown;
};

export type AdminFileByPath = {
    content: string;
    blob_id?: string;
    sha?: string;
    [key: string]: unknown;
};

export type AdminFileContent = {
    content: string;
    raw?: Uint8Array;
    [key: string]: unknown;
};

export type AdminCommitAction = {
    action: string;
    file_path?: string;
    path?: string;
    previous_path?: string;
    content?: string;
    encoding?: string;
    last_commit_id?: string;
    execute_filemode?: boolean;
    [key: string]: unknown;
};

export type AdminPipeline = {
    id?: string | number;
    status?: string;
    created_at?: string;
    [key: string]: unknown;
};

export type AdminPipelineJob = {
    id?: string | number;
    name?: string;
    status?: string;
    started_at?: string;
    [key: string]: unknown;
};

export abstract class OAuth2Client<TConfig extends OAuth2ClientConfig = OAuth2ClientConfig> {
    abstract readonly id: OAuth2ProviderId;
    abstract readonly name: string;

    protected config: TConfig | null = null;

    constructor(config?: TConfig) {
        if (config) {
            this.configure(config);
        }
    }

    configure(config: TConfig): void {
        this.config = config;
    }

    getConfig(): TConfig {
        if (!this.config) {
            throw new Error(`${this.name} OAuth config is missing.`);
        }
        this.validateConfig(this.config);
        return this.config;
    }

    getRedirectUri(): string {
        const config = this.getConfig();
        return config.redirectUri || `${window.location.origin}/admin`;
    }

    getAccessToken(): string | null {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(this.tokenKey);
    }

    getRefreshToken(): string | null {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(`${this.tokenKey}_refresh_token`);
    }

    isLoggedIn(): boolean {
        return !!this.getAccessToken();
    }

    logout(): void {
        localStorage.removeItem(this.tokenKey);
        localStorage.removeItem(`${this.tokenKey}_expires_at`);
        localStorage.removeItem(`${this.tokenKey}_refresh_token`);
        window.location.reload();
    }

    protected storeToken(accessToken: string, refreshToken?: string, expiresIn?: number | string): void {
        localStorage.setItem(this.tokenKey, accessToken);
        if (refreshToken) {
            localStorage.setItem(`${this.tokenKey}_refresh_token`, refreshToken);
        }
        if (expiresIn) {
            localStorage.setItem(`${this.tokenKey}_expires_at`, String(Date.now() + Number(expiresIn) * 1000));
        }
    }

    protected abstract readonly tokenKey: string;
    protected abstract validateConfig(config: TConfig): void;
    abstract redirectToAuth(): void | Promise<void>;
    abstract handleCallback(): Promise<string | null>;
    abstract getUser(): Promise<AdminUser>;
    abstract getFileByPath(path?: string): Promise<AdminFileByPath>;
    abstract getDirectoryContents(path?: string): Promise<AdminTreeItem[]>;
    abstract getTreeRecursive(path?: string): Promise<AdminTreeItem[]>;
    abstract getTree(path?: string): Promise<AdminTreeItem[]>;
    abstract getFileContent(fileSha: string): Promise<AdminFileContent>;
    abstract getFileRaw(fileSha: string): Promise<Uint8Array>;
    abstract updateFile(path: string, content: string, message?: string): Promise<unknown>;
    abstract commitBatch(actions: AdminCommitAction[], message?: string): Promise<unknown>;
    abstract getLatestPipeline(): Promise<AdminPipeline | null>;
    abstract getPipelineJobs(pipelineId?: string | number): Promise<AdminPipelineJob[]>;
    abstract createFile(path: string, content?: string, message?: string): Promise<unknown>;
    abstract deleteFile(path: string, message?: string): Promise<unknown>;
    abstract deleteDirectory(path: string, message?: string): Promise<unknown>;
    abstract renameItem(oldPath: string, newPath: string, isDir?: boolean, message?: string): Promise<unknown>;
    abstract readFileReadonly(path: string): Promise<string | null>;
    abstract readTreeReadonly(path?: string, recursive?: boolean): Promise<string[] | null>;
}
