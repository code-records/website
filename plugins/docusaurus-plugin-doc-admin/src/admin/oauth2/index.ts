import { GiteeOAuth2Client } from './providers/GiteeOAuth2Client';
import type { GiteeOAuth2Config } from './providers/GiteeOAuth2Client';
import type { OAuth2Client } from './OAuth2Client';

type DocAdminPluginData = {
    gitee?: GiteeOAuth2Config;
};

export let oauth2Client: OAuth2Client | null = null;

export function initOAuth2Client(pluginData: DocAdminPluginData): void {
    if (pluginData.gitee) {
        oauth2Client = new GiteeOAuth2Client(pluginData.gitee);
        return;
    }
    throw new Error('OAuth2 config is missing from pluginData.');
}
