import type { Database } from '@flowtask/database';
import { projectIntegrations, externalLinks, taskStates, labels, users } from '@flowtask/database';
import { eq, and, inArray } from 'drizzle-orm';
import { createGitHubClientForInstallation } from './client.js';

interface GitHubIntegrationConfig {
  installationId?: number;
  repositories?: Array<{
    owner: string;
    repo: string;
    installationId?: number;
  }>;
}

interface ExternalLinkWithIntegration {
  link: {
    id: string;
    taskId: string;
    externalId: string;
    externalType: string;
    externalUrl: string;
    lastSyncedAt: Date | null;
  };
  integration: {
    id: string;
    config: unknown;
  };
}

/**
 * Service for syncing FlowTask changes back to GitHub (reverse sync).
 * This enables two-way sync: FlowTask -> GitHub
 */
export class GitHubReverseSyncService {
  constructor(private db: Database) {}

  /**
   * Sync task changes to the linked GitHub issue.
   * Called after task updates in FlowTask.
   */
  async syncTaskToGitHub(
    taskId: string,
    changes: {
      title?: string;
      description?: string;
      stateId?: string | null;
      priority?: string | null;
      labelIds?: string[];
    },
    options?: {
      skipIfRecentSync?: boolean;
      syncOrigin?: string;
    }
  ): Promise<{ synced: boolean; reason?: string }> {
    // 1. Find the GitHub external link for this task
    const linkResult = await this.findGitHubLink(taskId);
    if (!linkResult) {
      return { synced: false, reason: 'No GitHub link found for task' };
    }

    const { link, integration } = linkResult;
    const config = integration.config as GitHubIntegrationConfig;

    // 2. Check for recent sync to prevent loops (optional)
    if (options?.skipIfRecentSync && link.lastSyncedAt) {
      const timeSinceSync = Date.now() - new Date(link.lastSyncedAt).getTime();
      if (timeSinceSync < 5000) { // 5 seconds
        return { synced: false, reason: 'Recent sync detected, skipping to prevent loop' };
      }
    }

    // 3. Get the repo configuration
    const repoInfo = this.extractRepoFromLinkUrl(link);
    if (!repoInfo) {
      return { synced: false, reason: 'Could not determine repository from link' };
    }

    const installationId = this.getInstallationIdForRepo(config, repoInfo.owner, repoInfo.repo);
    if (!installationId) {
      return { synced: false, reason: 'GitHub App not installed' };
    }

    // 4. Create GitHub client
    const client = await createGitHubClientForInstallation(installationId, {
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    });

    const issueNumber = parseInt(link.externalId, 10);

    try {
      // 5. Build updates for GitHub
      const updates: { title?: string; body?: string; state?: 'open' | 'closed' } = {};

      if (changes.title !== undefined) {
        updates.title = changes.title;
      }

      if (changes.description !== undefined) {
        updates.body = changes.description || '';
      }

      // 6. Map state category to GitHub issue state
      if (changes.stateId !== undefined) {
        const stateCategory = await this.getStateCategory(changes.stateId);
        if (stateCategory === 'done') {
          updates.state = 'closed';
        } else if (stateCategory) {
          updates.state = 'open';
        }
      }

      // 7. Update the issue if there are changes
      if (Object.keys(updates).length > 0) {
        await client.updateIssue(issueNumber, updates);
      }

      // 8. Sync labels if changed
      if (changes.labelIds !== undefined) {
        const labelNames = await this.getLabelNames(changes.labelIds);
        await client.setIssueLabels(issueNumber, labelNames);
      }

      // 9. Update last synced timestamp with sync origin marker
      await this.db
        .update(externalLinks)
        .set({
          lastSyncedAt: new Date(),
        })
        .where(eq(externalLinks.id, link.id));

      return { synced: true };
    } catch (error) {
      console.error('Error syncing task to GitHub:', error);
      return {
        synced: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Sync a FlowTask comment to the linked GitHub issue.
   */
  async syncCommentToGitHub(
    taskId: string,
    comment: {
      content: string;
      authorId: string | null;
      authorName?: string;
    }
  ): Promise<{ synced: boolean; reason?: string }> {
    // 1. Find the GitHub external link for this task
    const linkResult = await this.findGitHubLink(taskId);
    if (!linkResult) {
      return { synced: false, reason: 'No GitHub link found for task' };
    }

    const { link, integration } = linkResult;
    const config = integration.config as GitHubIntegrationConfig;

    // 2. Get repo info from link
    const repoInfo = this.extractRepoFromLinkUrl(link);
    if (!repoInfo) {
      return { synced: false, reason: 'Could not determine repository from link' };
    }

    const installationId = this.getInstallationIdForRepo(config, repoInfo.owner, repoInfo.repo);
    if (!installationId) {
      return { synced: false, reason: 'GitHub App not installed' };
    }

    // 3. Get author name if not provided
    let authorName = comment.authorName;
    if (!authorName && comment.authorId) {
      const [user] = await this.db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, comment.authorId));
      authorName = user?.name || 'Unknown User';
    }

    // 4. Create GitHub client
    const client = await createGitHubClientForInstallation(installationId, {
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    });

    const issueNumber = parseInt(link.externalId, 10);

    try {
      // 5. Post comment with attribution
      const body = `**${authorName || 'FlowTask User'}** commented via FlowTask:\n\n${comment.content}`;
      await client.addIssueComment(issueNumber, body);

      return { synced: true };
    } catch (error) {
      console.error('Error syncing comment to GitHub:', error);
      return {
        synced: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Sync task assignees to GitHub issue.
   */
  async syncAssigneesToGitHub(
    taskId: string,
    action: 'add' | 'remove',
    userId: string
  ): Promise<{ synced: boolean; reason?: string }> {
    // 1. Find the GitHub external link for this task
    const linkResult = await this.findGitHubLink(taskId);
    if (!linkResult) {
      return { synced: false, reason: 'No GitHub link found for task' };
    }

    const { link, integration } = linkResult;
    const config = integration.config as GitHubIntegrationConfig;

    const repoInfo = this.extractRepoFromLinkUrl(link);
    if (!repoInfo) {
      return { synced: false, reason: 'Could not determine repository from link' };
    }

    const installationId = this.getInstallationIdForRepo(config, repoInfo.owner, repoInfo.repo);
    if (!installationId) {
      return { synced: false, reason: 'GitHub App not installed' };
    }

    // 2. Get user's GitHub username (would need to be stored/mapped)
    // For now, we'll skip this as we don't have GitHub username mapping
    // TODO: Add user.githubUsername to users table for proper sync
    return { synced: false, reason: 'GitHub username mapping not implemented' };
  }

  /**
   * Close the linked GitHub issue when a task is deleted.
   */
  async closeGitHubIssue(taskId: string): Promise<{ synced: boolean; reason?: string }> {
    const linkResult = await this.findGitHubLink(taskId);
    if (!linkResult) {
      return { synced: false, reason: 'No GitHub link found for task' };
    }

    const { link, integration } = linkResult;
    const config = integration.config as GitHubIntegrationConfig;

    const repoInfo = this.extractRepoFromLinkUrl(link);
    if (!repoInfo) {
      return { synced: false, reason: 'Could not determine repository from link' };
    }

    const installationId = this.getInstallationIdForRepo(config, repoInfo.owner, repoInfo.repo);
    if (!installationId) {
      return { synced: false, reason: 'GitHub App not installed' };
    }

    const client = await createGitHubClientForInstallation(installationId, {
      owner: repoInfo.owner,
      repo: repoInfo.repo,
    });

    const issueNumber = parseInt(link.externalId, 10);

    try {
      await client.updateIssue(issueNumber, { state: 'closed' });
      return { synced: true };
    } catch (error) {
      console.error('Error closing GitHub issue:', error);
      return {
        synced: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if a task update came from GitHub (to prevent sync loops).
   */
  async isRecentGitHubSync(taskId: string, thresholdMs = 5000): Promise<boolean> {
    const linkResult = await this.findGitHubLink(taskId);
    if (!linkResult?.link.lastSyncedAt) {
      return false;
    }

    const timeSinceSync = Date.now() - new Date(linkResult.link.lastSyncedAt).getTime();
    return timeSinceSync < thresholdMs;
  }

  /**
   * Find the GitHub external link for a task.
   */
  private async findGitHubLink(taskId: string): Promise<ExternalLinkWithIntegration | null> {
    const [result] = await this.db
      .select({
        link: {
          id: externalLinks.id,
          taskId: externalLinks.taskId,
          externalId: externalLinks.externalId,
          externalType: externalLinks.externalType,
          externalUrl: externalLinks.externalUrl,
          lastSyncedAt: externalLinks.lastSyncedAt,
        },
        integration: {
          id: projectIntegrations.id,
          config: projectIntegrations.config,
        },
      })
      .from(externalLinks)
      .innerJoin(projectIntegrations, eq(externalLinks.integrationId, projectIntegrations.id))
      .where(
        and(
          eq(externalLinks.taskId, taskId),
          eq(externalLinks.externalType, 'github_issue')
        )
      );

    if (!result) {
      return null;
    }

    return {
      link: {
        id: result.link.id,
        taskId: result.link.taskId,
        externalId: result.link.externalId,
        externalType: result.link.externalType,
        externalUrl: result.link.externalUrl || '',
        lastSyncedAt: result.link.lastSyncedAt,
      },
      integration: result.integration,
    };
  }

  /**
   * Resolve the installation ID for a specific repo.
   * Checks per-repo installationId first, falls back to top-level legacy field.
   */
  private getInstallationIdForRepo(
    config: GitHubIntegrationConfig,
    owner: string,
    repo: string
  ): number | null {
    const repoEntry = config.repositories?.find(
      (r) => r.owner === owner && r.repo === repo
    );
    return repoEntry?.installationId ?? config.installationId ?? null;
  }

  /**
   * Extract owner and repo from the external link URL.
   */
  private extractRepoFromLinkUrl(link: { externalUrl: string }): { owner: string; repo: string } | null {
    if (!link.externalUrl) {
      return null;
    }

    // Parse URL like: https://github.com/owner/repo/issues/123
    const match = link.externalUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match || !match[1] || !match[2]) {
      return null;
    }

    return {
      owner: match[1],
      repo: match[2],
    };
  }

  /**
   * Get the category of a task state.
   */
  private async getStateCategory(stateId: string | null): Promise<string | null> {
    if (!stateId) {
      return null;
    }

    const [state] = await this.db
      .select({ category: taskStates.category })
      .from(taskStates)
      .where(eq(taskStates.id, stateId));

    return state?.category || null;
  }

  /**
   * Get label names from label IDs.
   */
  private async getLabelNames(labelIds: string[]): Promise<string[]> {
    if (labelIds.length === 0) {
      return [];
    }

    const labelRows = await this.db
      .select({ name: labels.name })
      .from(labels)
      .where(inArray(labels.id, labelIds));

    return labelRows.map((l) => l.name);
  }
}
