import type { Database } from '@flowtask/database';
import { projectIntegrations, externalLinks, tasks } from '@flowtask/database';
import { eq, and } from 'drizzle-orm';
import type { GitHubConfig } from '../types.js';
import { createGitHubClientForInstallation, type GitHubClient } from './client.js';
import { GitHubWebhookHandler } from './webhook.js';
import { TaskService } from '@flowtask/domain';
import { positionAfter } from '@flowtask/shared';

/**
 * Service for syncing GitHub issues to FlowTask tasks.
 * One-way sync: GitHub → FlowTask
 */
export class GitHubSyncService {
  private webhookHandler = new GitHubWebhookHandler();

  constructor(
    private db: Database,
    private taskService: TaskService
  ) {}

  /**
   * Perform initial sync of all open issues from GitHub.
   */
  async initialSync(integrationId: string, projectId: string, config: GitHubConfig): Promise<{
    created: number;
    updated: number;
    errors: string[];
  }> {
    const result = { created: 0, updated: 0, errors: [] as string[] };
    const repoName = `${config.owner}/${config.repo}`;

    console.log(`[GitHub Sync] initialSync started for ${repoName} (integration: ${integrationId})`);

    try {
      // Update sync status
      await this.updateSyncStatus(integrationId, 'syncing');

      const client = await createGitHubClientForInstallation(config.installationId, config);

      // Fetch all open issues
      const issues = await client.listIssues({ state: 'open', per_page: 100 });
      console.log(`[GitHub Sync] Fetched ${issues.length} open issues from ${repoName}`);

      for (const issue of issues) {
        try {
          // Check if we already have this issue linked
          const [existingLink] = await this.db
            .select()
            .from(externalLinks)
            .where(
              and(
                eq(externalLinks.integrationId, integrationId),
                eq(externalLinks.externalType, 'github_issue'),
                eq(externalLinks.externalId, issue.number.toString())
              )
            );

          if (existingLink) {
            // Update existing task
            const updateResult = await this.taskService.update(existingLink.taskId, {
              title: issue.title,
              description: issue.body || undefined,
              priority: this.webhookHandler.mapLabelsToPriority(issue.labels as { name: string }[]),
              updatedBy: null,
            });

            if (updateResult.ok) {
              result.updated++;
            } else {
              result.errors.push(`Failed to update task for issue #${issue.number}: ${updateResult.error.message}`);
            }
          } else {
            // Create new task
            const taskData = this.webhookHandler.buildTaskFromIssue(issue as any);

            const createResult = await this.taskService.create({
              projectId,
              title: taskData.title,
              description: taskData.description || undefined,
              priority: taskData.priority || undefined,
              createdBy: null,
            });

            if (createResult.ok) {
              // Create external link
              await this.db.insert(externalLinks).values({
                integrationId,
                taskId: createResult.value.id,
                externalType: 'github_issue',
                externalId: taskData.externalId,
                externalUrl: taskData.externalUrl,
                lastSyncedAt: new Date(),
              });

              result.created++;
            } else {
              result.errors.push(`Failed to create task for issue #${issue.number}: ${createResult.error.message}`);
            }
          }
        } catch (error) {
          const errorMsg = `Error processing issue #${issue.number}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(`[GitHub Sync] ${errorMsg}`);
          result.errors.push(errorMsg);
        }
      }

      // Update sync status
      await this.updateSyncStatus(integrationId, 'synced');
      console.log(`[GitHub Sync] Completed for ${repoName}: ${result.created} created, ${result.updated} updated, ${result.errors.length} errors`);
    } catch (error) {
      const errorMsg = `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[GitHub Sync] ${errorMsg}`, error);
      await this.updateSyncStatus(integrationId, 'error', error instanceof Error ? error.message : 'Unknown error');
      // Re-throw critical errors (credentials missing, API failures) so the caller can handle them
      throw error;
    }

    return result;
  }

  /**
   * Sync a single issue from a webhook event.
   */
  async syncIssue(
    integrationId: string,
    projectId: string,
    config: GitHubConfig,
    issueNumber: number
  ): Promise<{ taskId: string; action: 'created' | 'updated' | 'linked' }> {
    const client = await createGitHubClientForInstallation(config.installationId, config);
    const issue = await client.getIssue(issueNumber);

    // Check if we already have this issue linked
    const [existingLink] = await this.db
      .select()
      .from(externalLinks)
      .where(
        and(
          eq(externalLinks.integrationId, integrationId),
          eq(externalLinks.externalType, 'github_issue'),
          eq(externalLinks.externalId, issueNumber.toString())
        )
      );

    if (existingLink) {
      // Update existing task
      const taskData = this.webhookHandler.buildTaskFromIssue(issue as any);
      await this.taskService.update(existingLink.taskId, {
        title: taskData.title,
        description: taskData.description || undefined,
        priority: taskData.priority || undefined,
        updatedBy: null,
      });

      // Update last synced timestamp
      await this.db
        .update(externalLinks)
        .set({ lastSyncedAt: new Date() })
        .where(eq(externalLinks.id, existingLink.id));

      return { taskId: existingLink.taskId, action: 'updated' };
    }

    // Create new task
    const taskData = this.webhookHandler.buildTaskFromIssue(issue as any);
    const createResult = await this.taskService.create({
      projectId,
      title: taskData.title,
      description: taskData.description || undefined,
      priority: taskData.priority || undefined,
      createdBy: null,
    });

    if (!createResult.ok) {
      throw createResult.error;
    }

    // Create external link
    await this.db.insert(externalLinks).values({
      integrationId,
      taskId: createResult.value.id,
      externalType: 'github_issue',
      externalId: taskData.externalId,
      externalUrl: taskData.externalUrl,
      lastSyncedAt: new Date(),
    });

    return { taskId: createResult.value.id, action: 'created' };
  }

  /**
   * Link a PR to an existing task.
   */
  async linkPullRequest(
    integrationId: string,
    taskId: string,
    prNumber: number,
    prUrl: string
  ): Promise<void> {
    // Check if link already exists
    const [existing] = await this.db
      .select()
      .from(externalLinks)
      .where(
        and(
          eq(externalLinks.integrationId, integrationId),
          eq(externalLinks.taskId, taskId),
          eq(externalLinks.externalType, 'github_pr'),
          eq(externalLinks.externalId, prNumber.toString())
        )
      );

    if (!existing) {
      await this.db.insert(externalLinks).values({
        integrationId,
        taskId,
        externalType: 'github_pr',
        externalId: prNumber.toString(),
        externalUrl: prUrl,
        lastSyncedAt: new Date(),
      });
    }
  }

  /**
   * Find a task by its external ID (issue number).
   */
  async findTaskByExternalId(
    integrationId: string,
    externalType: 'github_issue' | 'github_pr',
    externalId: string
  ): Promise<string | null> {
    const [link] = await this.db
      .select({ taskId: externalLinks.taskId })
      .from(externalLinks)
      .where(
        and(
          eq(externalLinks.integrationId, integrationId),
          eq(externalLinks.externalType, externalType),
          eq(externalLinks.externalId, externalId)
        )
      );

    return link?.taskId ?? null;
  }

  /**
   * Update integration sync status.
   */
  private async updateSyncStatus(
    integrationId: string,
    status: 'idle' | 'syncing' | 'synced' | 'error',
    error?: string
  ): Promise<void> {
    await this.db
      .update(projectIntegrations)
      .set({
        syncStatus: status,
        syncError: error || null,
        lastSyncAt: status === 'synced' ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(projectIntegrations.id, integrationId));
  }
}
