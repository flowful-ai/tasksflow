import type { Database } from '../../db/index.js';
import { comments, externalLinks, labels, projectIntegrations, users } from '../../db/index.js';
import { findInstallationForRepo, parseGitHubConfig, resolveGitHubLinkRef, type GitHubItemRef } from '@flowtask/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { NonRetryableError, registerBackgroundJob, scheduleBackgroundJob, type BackgroundJobPayload } from '../background.js';
import { createGitHubClientForInstallation, type GitHubClient } from './client.js';
import { computeIssueSyncHash } from './sync-hash.js';
import { getStateCategory } from './task-lookup.js';
import { issueContentFrom } from './webhook.js';

export interface TaskChangesForGitHub {
  title?: string;
  description?: string;
  stateId?: string | null;
  priority?: string | null;
  labelIds?: string[];
}

export interface CommentForGitHub {
  content: string;
  authorId: string | null;
  authorName?: string;
  /** FlowTask comment id; when set, the GitHub comment id is stored on it so the webhook echo is skipped. */
  commentId?: string;
}

export interface ReverseSyncResult {
  synced: boolean;
  reason?: string;
}

interface ResolvedIssueLink {
  linkId: string;
  ref: GitHubItemRef;
  client: GitHubClient;
}

export const REVERSE_SYNC_JOBS = {
  task: 'github.reverse_sync.task',
  comment: 'github.reverse_sync.comment',
  closeIssue: 'github.reverse_sync.close_issue',
} as const;

function optionalString(value: BackgroundJobPayload[string] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function payloadTaskId(payload: BackgroundJobPayload): string {
  const taskId = payload.taskId;
  if (typeof taskId !== 'string') throw new NonRetryableError('Job payload is missing taskId');
  return taskId;
}

function changesFromPayload(value: BackgroundJobPayload[string] | undefined): TaskChangesForGitHub {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const changes: TaskChangesForGitHub = {};
  if (typeof value.title === 'string') changes.title = value.title;
  if (typeof value.description === 'string') changes.description = value.description;
  if (typeof value.stateId === 'string' || value.stateId === null) changes.stateId = value.stateId;
  if (typeof value.priority === 'string' || value.priority === null) changes.priority = value.priority;
  if (Array.isArray(value.labelIds)) {
    changes.labelIds = value.labelIds.filter((id): id is string => typeof id === 'string');
  }
  return changes;
}

function commentFromPayload(value: BackgroundJobPayload[string] | undefined): CommentForGitHub {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.content !== 'string') {
    throw new NonRetryableError('Job payload is missing the comment');
  }
  return {
    content: value.content,
    authorId: optionalString(value.authorId) ?? null,
    authorName: optionalString(value.authorName),
    commentId: optionalString(value.commentId),
  };
}

function toPayload(value: TaskChangesForGitHub | CommentForGitHub): BackgroundJobPayload {
  const payload: BackgroundJobPayload = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) payload[key] = entry;
  }
  return payload;
}

/**
 * FlowTask → GitHub sync for tasks linked to a GitHub issue.
 *
 * API errors are thrown (so the job queue can retry them); a missing link
 * or unlinked repository returns `{ synced: false, reason }`.
 */
export class GitHubReverseSyncService {
  constructor(private readonly db: Database) {
    registerBackgroundJob(REVERSE_SYNC_JOBS.task, async (payload) => {
      await this.syncTaskToGitHub(payloadTaskId(payload), changesFromPayload(payload.changes));
    });
    registerBackgroundJob(REVERSE_SYNC_JOBS.comment, async (payload) => {
      await this.syncCommentToGitHub(payloadTaskId(payload), commentFromPayload(payload.comment));
    });
    registerBackgroundJob(REVERSE_SYNC_JOBS.closeIssue, async (payload) => {
      await this.closeGitHubIssue(payloadTaskId(payload));
    });
  }

  /**
   * Push task changes to the linked issue. After writing, the fresh issue
   * content is hashed and stored on the link, so the webhook echo is skipped
   * while genuine GitHub edits still apply.
   *
   * @param _options accepted for backward compatibility; the old 5-second
   *   `skipIfRecentSync` window is gone (it dropped genuine edits).
   */
  async syncTaskToGitHub(
    taskId: string,
    changes: TaskChangesForGitHub,
    _options?: { skipIfRecentSync?: boolean }
  ): Promise<ReverseSyncResult> {
    const resolved = await this.resolveIssueLink(taskId);
    if ('reason' in resolved) return { synced: false, reason: resolved.reason };
    const { client, ref, linkId } = resolved;

    const updates: { title?: string; body?: string; state?: 'open' | 'closed' } = {};
    if (changes.title !== undefined) updates.title = changes.title;
    if (changes.description !== undefined) updates.body = changes.description || '';
    if (changes.stateId !== undefined) {
      const category = await getStateCategory(this.db, changes.stateId);
      if (category) updates.state = category === 'done' ? 'closed' : 'open';
    }

    const labelNames = changes.labelIds !== undefined ? await this.getLabelNames(changes.labelIds) : null;
    if (Object.keys(updates).length === 0 && labelNames === null) {
      return { synced: false, reason: 'No GitHub-relevant changes' };
    }

    if (Object.keys(updates).length > 0) {
      await client.updateIssue(ref.number, updates);
    }
    if (labelNames !== null) {
      await client.setIssueLabels(ref.number, labelNames);
    }

    await this.recordSyncedContent(client, ref.number, linkId);
    return { synced: true };
  }

  /** Post a FlowTask comment to the linked issue. */
  async syncCommentToGitHub(taskId: string, comment: CommentForGitHub): Promise<ReverseSyncResult> {
    const resolved = await this.resolveIssueLink(taskId);
    if ('reason' in resolved) return { synced: false, reason: resolved.reason };

    let authorName = comment.authorName;
    if (!authorName && comment.authorId) {
      const [user] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, comment.authorId));
      authorName = user?.name ?? undefined;
    }

    const body = `**${authorName || 'FlowTask User'}** commented via FlowTask:\n\n${comment.content}`;
    const created = await resolved.client.addIssueComment(resolved.ref.number, body);

    if (comment.commentId) {
      // Don't throw here: the GitHub comment exists, and a retry would post it twice.
      try {
        await this.db
          .update(comments)
          .set({ externalCommentId: created.id.toString() })
          .where(eq(comments.id, comment.commentId));
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'github_comment_id_store_failed',
            commentId: comment.commentId,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }
    return { synced: true };
  }

  /** GitHub username mapping isn't implemented, so assignees aren't pushed. */
  async syncAssigneesToGitHub(_taskId: string, _action: 'add' | 'remove', _userId: string): Promise<ReverseSyncResult> {
    return { synced: false, reason: 'GitHub username mapping not implemented' };
  }

  /** Close the linked GitHub issue (used when a task is deleted). */
  async closeGitHubIssue(taskId: string): Promise<ReverseSyncResult> {
    const resolved = await this.resolveIssueLink(taskId);
    if ('reason' in resolved) return { synced: false, reason: resolved.reason };
    await resolved.client.updateIssue(resolved.ref.number, { state: 'closed' });
    await this.recordSyncedContent(resolved.client, resolved.ref.number, resolved.linkId);
    return { synced: true };
  }

  // ============ Background entry points (single retry seam) ============

  scheduleTaskSync(taskId: string, changes: TaskChangesForGitHub): void {
    scheduleBackgroundJob(REVERSE_SYNC_JOBS.task, { taskId, changes: toPayload(changes) }, { context: { taskId } });
  }

  scheduleCommentSync(taskId: string, comment: CommentForGitHub): void {
    scheduleBackgroundJob(
      REVERSE_SYNC_JOBS.comment,
      { taskId, comment: toPayload(comment) },
      { context: { taskId, commentId: comment.commentId } }
    );
  }

  scheduleIssueClose(taskId: string): void {
    scheduleBackgroundJob(REVERSE_SYNC_JOBS.closeIssue, { taskId }, { context: { taskId } });
  }

  // ============ Helpers ============

  private async recordSyncedContent(client: GitHubClient, issueNumber: number, linkId: string): Promise<void> {
    const fresh = await client.getIssue(issueNumber);
    await this.db
      .update(externalLinks)
      .set({ syncHash: computeIssueSyncHash(issueContentFrom(fresh)), lastSyncedAt: new Date() })
      .where(eq(externalLinks.id, linkId));
  }

  private async resolveIssueLink(taskId: string): Promise<ResolvedIssueLink | { reason: string }> {
    const [row] = await this.db
      .select({
        linkId: externalLinks.id,
        externalId: externalLinks.externalId,
        externalUrl: externalLinks.externalUrl,
        config: projectIntegrations.config,
        isEnabled: projectIntegrations.isEnabled,
      })
      .from(externalLinks)
      .innerJoin(projectIntegrations, eq(externalLinks.integrationId, projectIntegrations.id))
      .where(and(eq(externalLinks.taskId, taskId), eq(externalLinks.externalType, 'github_issue')));

    if (!row) return { reason: 'No GitHub link found for task' };
    if (!row.isEnabled) return { reason: 'GitHub integration disabled' };

    const ref = resolveGitHubLinkRef(row);
    if (!ref) return { reason: 'Could not determine repository from link' };

    const installationId = findInstallationForRepo(parseGitHubConfig(row.config), ref.owner, ref.repo);
    if (!installationId) return { reason: 'Repository is no longer linked to this project' };

    const client = await createGitHubClientForInstallation(installationId, { owner: ref.owner, repo: ref.repo });
    return { linkId: row.linkId, ref, client };
  }

  private async getLabelNames(labelIds: string[]): Promise<string[]> {
    if (labelIds.length === 0) return [];
    const rows = await this.db.select({ name: labels.name }).from(labels).where(inArray(labels.id, labelIds));
    return rows.map((l) => l.name);
  }
}
