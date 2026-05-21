import type { ReadonlyClient } from './ReadonlyClient';

const READONLY_BASE = '/agent-tools-gitee/api/v5';

type GiteeReadonlyConfig = {
    owner: string;
    repo: string;
    ref: string;
};

export class GiteeReadonlyClient implements ReadonlyClient {
    constructor(private readonly config: GiteeReadonlyConfig) { }

    private encodeGitPath(path = ''): string {
        return String(path)
            .replace(/^\.?\//, '')
            .replace(/\\/g, '/')
            .split('/')
            .filter(Boolean)
            .map(encodeURIComponent)
            .join('/');
    }

    async readFileReadonly(path: string): Promise<string | null> {
        const params = new URLSearchParams({ ref: this.config.ref });
        const url = `${READONLY_BASE}/repos/${this.config.owner}/${this.config.repo}/raw/${this.encodeGitPath(path)}?${params}`;
        const res = await fetch(url);

        if (res.ok) return res.text();
        if (res.status === 404) return null;
        throw new Error(`Gitee readonly read failed: ${res.status}`);
    }

    async readTreeReadonly(path = '', recursive = false): Promise<string[] | null> {
        const params = new URLSearchParams({ ref: this.config.ref });
        const encoded = this.encodeGitPath(path);
        const repoPath = encoded
            ? `/repos/${this.config.owner}/${this.config.repo}/contents/${encoded}`
            : `/repos/${this.config.owner}/${this.config.repo}/contents`;
        const url = `${READONLY_BASE}${repoPath}?${params}`;
        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`Gitee readonly request failed: ${response.status}`);
        }

        const res = await response.json();
        if (!res) return null;

        const entries = Array.isArray(res) ? res : [res];
        let paths = entries.map((item) => item.path).filter(Boolean);

        if (recursive) {
            for (const item of entries) {
                if (item.type === 'dir' || item.type === 'tree') {
                    const childPaths = await this.readTreeReadonly(item.path, true);
                    if (childPaths) paths = paths.concat(childPaths);
                }
            }
        }

        return paths;
    }
}
