import { GitHubConfigSchema, type GitHubConfig } from '@flowtask/shared';
import type { IntegrationProvider } from '../types.js';
import { getGitHubAppId } from './client.js';
import { readSecretEnv } from '../env.js';

/**
 * GitHub integration provider (config validation).
 * Sync is two-way: GitHubWebhookProcessor/GitHubSyncService (GitHub → FlowTask)
 * and GitHubReverseSyncService (FlowTask → GitHub).
 */
export class GitHubProvider implements IntegrationProvider<GitHubConfig> {
  type = 'github' as const;
  name = 'GitHub';

  validateConfig(config: unknown): config is GitHubConfig {
    return GitHubConfigSchema.safeParse(config).success;
  }

  isConfigured(config: GitHubConfig): boolean {
    return (
      config.repositories.length > 0 &&
      getGitHubAppId() !== null &&
      readSecretEnv('GITHUB_APP_PRIVATE_KEY') !== undefined
    );
  }
}
