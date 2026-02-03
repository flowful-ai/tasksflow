import type { IntegrationProvider, GitHubConfig, WebhookResult, GitHubIssueWebhookPayload, GitHubPRWebhookPayload } from '../types.js';
import type { TaskEvent } from '@flowtask/shared';
import { GitHubWebhookHandler } from './webhook.js';

/**
 * GitHub integration provider.
 * Implements one-way sync: GitHub → FlowTask
 */
export class GitHubProvider implements IntegrationProvider<GitHubConfig> {
  type = 'github' as const;
  name = 'GitHub';

  private webhookHandler = new GitHubWebhookHandler();

  /**
   * Validate GitHub configuration.
   */
  validateConfig(config: unknown): config is GitHubConfig {
    if (!config || typeof config !== 'object') {
      return false;
    }

    const c = config as Record<string, unknown>;

    return (
      typeof c.owner === 'string' &&
      c.owner.length > 0 &&
      typeof c.repo === 'string' &&
      c.repo.length > 0 &&
      typeof c.installationId === 'number' &&
      c.installationId > 0
    );
  }

  /**
   * Handle incoming GitHub webhooks.
   */
  async handleWebhook(payload: unknown, config: GitHubConfig): Promise<WebhookResult> {
    // Determine event type from payload structure
    if (this.isIssuePayload(payload)) {
      return this.webhookHandler.handleIssueEvent(payload, config);
    }

    if (this.isPRPayload(payload)) {
      return this.webhookHandler.handlePREvent(payload, config);
    }

    return { action: 'ignore' };
  }

  /**
   * GitHub integration does not send notifications (one-way sync).
   * Tasks are synced from GitHub, not to GitHub.
   */
  async notify(event: TaskEvent, config: GitHubConfig): Promise<void> {
    // No-op: We don't sync back to GitHub
    // This is intentional - GitHub is the source of truth
  }

  /**
   * Check if the integration is properly configured.
   */
  isConfigured(config: GitHubConfig): boolean {
    return this.validateConfig(config);
  }

  private isIssuePayload(payload: unknown): payload is GitHubIssueWebhookPayload {
    return (
      payload !== null &&
      typeof payload === 'object' &&
      'issue' in payload &&
      'action' in payload &&
      !('pull_request' in payload)
    );
  }

  private isPRPayload(payload: unknown): payload is GitHubPRWebhookPayload {
    return (
      payload !== null &&
      typeof payload === 'object' &&
      'pull_request' in payload &&
      'action' in payload
    );
  }
}
