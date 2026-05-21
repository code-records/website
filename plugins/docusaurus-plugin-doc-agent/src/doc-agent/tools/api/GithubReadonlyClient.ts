import type { ReadonlyClient } from './ReadonlyClient';

const READONLY_BASE = '/agent-tools-github';

type GithubReadonlyConfig = {
    owner: string;
    repo: string;
    ref: string;
};

type GithubContentsItem = {
    path?: string;
    type?: string;
};

export class GithubReadonlyClient implements ReadonlyClient {
    constructor(private readonly config: GithubReadonlyConfig) { }

    private encodeGitPath(path = ''): string {
        return String(path)
            .replace(/^\.?\//, '')
            .replace(/\\/g, '/')
            .split('/')
            .filter(Boolean)
            .map(encodeURIComponent)
            .join('/');
    }

    private buildContentsUrl(path = ''): string {
        const params = new URLSearchParams({ ref: this.config.ref });
        const encoded = this.encodeGitPath(path);
        const repoPath = encoded
            ? `/repos/${this.config.owner}/${this.config.repo}/contents/${encoded}`
            : `/repos/${this.config.owner}/${this.config.repo}/contents`;

        return `${READONLY_BASE}${repoPath}?${params}`;
    }

    async readFileReadonly(path: string): Promise<string | null> {
        const res = await fetch(this.buildContentsUrl(path), {
            headers: {
                Accept: 'application/vnd.github.raw+json',
            },
        });

        if (res.ok) return res.text();
        if (res.status === 404) return null;
        throw new Error(`GitHub readonly read failed: ${res.status}`);
    }

    async readTreeReadonly(path = '', recursive = false): Promise<string[] | null> {
        const response = await fetch(this.buildContentsUrl(path));

        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`GitHub readonly request failed: ${response.status}`);
        }

        const res = await response.json();
        if (!res) return null;

        const entries: GithubContentsItem[] = Array.isArray(res) ? res : [res];
        let paths = entries.map((item) => item.path).filter(Boolean) as string[];

        if (recursive) {
            for (const item of entries) {
                if (item.type === 'dir' && item.path) {
                    const childPaths = await this.readTreeReadonly(item.path, true);
                    if (childPaths) paths = paths.concat(childPaths);
                }
            }
        }

        return paths;
    }
}
