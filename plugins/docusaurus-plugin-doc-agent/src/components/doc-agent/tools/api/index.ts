import { GiteeReadonlyClient } from './GiteeReadonlyClient';
import { GithubReadonlyClient } from './GithubReadonlyClient';
import type { ReadonlyClient } from './ReadonlyClient';

type GiteeReadonlyConfig = {
    owner: string;
    repo: string;
    ref: string;
};

type GithubReadonlyConfig = {
    owner: string;
    repo: string;
    ref: string;
    endpoint?: string;
    personalAccessToken?: string;
};

type DocAgentPluginData = {
    gitee?: GiteeReadonlyConfig;
    github?: GithubReadonlyConfig;
};

export let readonlyClient: ReadonlyClient | null = null;

export function initReadonlyClient(pluginData: DocAgentPluginData): void {
    if (pluginData.github) {
        readonlyClient = new GithubReadonlyClient(pluginData.github);
        return;
    }

    if (pluginData.gitee) {
        readonlyClient = new GiteeReadonlyClient(pluginData.gitee);
        return;
    }

    throw new Error('Readonly repository config is missing from pluginData.');
}
