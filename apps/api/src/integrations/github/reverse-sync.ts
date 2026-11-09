import type { Database } from '../../db/index.js';
import {
  comments,
  externalLinks,
  labels,
  projectIntegrations,
  taskLabels,
  tasks,
  users,
} from '../../db/index.js';
import {
  findInstallationForRepo,
  isJsonValue,
  parseGitHubConfig,
  resolveGitHubLinkRef,
  type GitHubItemRef,
} from '@flowtask/shared';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  NonRetryableError,
  registerBackgroundJob,
  scheduleBackgroundJob,
  type BackgroundJobPayload,
} from '../background.js';
import type { GitHubRepoRef } from '../types.js';
import { createGitHubClientForInstallation } from './client.js';
import { computeIssueSyncHash } from './sync-hash.js';
import { getStateCategory } from './task-lookup.js';
import { issueContentFrom, type IssueContent } from './webhook.js';

/**
 * Which kinds of task change a reverse-sync job pushes. Only the kinds are
 * queued, never the values: the job reads the task's current title,
 * description, state and labels when it runs, so retries and out-of-order
 * runs can never push an older value over a newer one.
 */
export interface TaskChangesForGitHub {
  title?: boolean;
  description?: boolean;
  /** Open/closed, from the task's current state category (and deletion). */
  state?: boolean;
  labels?: boolean;
}

const CHANGE_KINDS = ['title', 'description', 'state', 'labels'] as const;

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

/** The GitHub calls reverse sync makes (GitHubClient implements it; tests pass a fake). */
export interface ReverseSyncGitHubClient {
  getIssue(issueNumber: number): Promise<Parameters<typeof issueContentFrom>[0]>;
  updateIssue(
    issueNumber: number,
    updates: { title?: string; body?: string; state?: 'open' | 'closed' }
  ): Promise<object>;
  setIssueLabels(issueNumber: number, labels: string[]): Promise<object>;
  addIssueComment(issueNumber: number, body: string): Promise<{ id: number }>;
}

export type ReverseSyncClientFactory = (
  installationId: number,
  repo: GitHubRepoRef
) => Promise<ReverseSyncGitHubClient>;

interface ResolvedIssueLink {
  linkId: string;
  syncHash: string | null;
  ref: GitHubItemRef;
  client: ReverseSyncGitHubClient;
}

export const REVERSE_SYNC_JOBS = {
  task: 'github.reverse_sync.task',
  comment: 'github.reverse_sync.comment',
} as const;

/** One pending task reverse-sync job per task: later changes coalesce into it. */
export function reverseSyncJobKey(taskId: string): string {
  return `${REVERSE_SYNC_JOBS.task}:${taskId}`;
}

function optionalString(value: BackgroundJobPayload[string] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function payloadTaskId(payload: BackgroundJobPayload): string {
  const taskId = payload.taskId;
  if (typeof taskId !== 'string') throw new NonRetryableError('Job payload is missing taskId');
  return taskId;
}

/** Change kinds from a job payload (flags at the top level, so coalescing merges them). */
export function changeKindsFromPayload(payload: BackgroundJobPayload): TaskChangesForGitHub {
  const kinds: TaskChangesForGitHub = {};
  for (const kind of CHANGE_KINDS) {
    if (payload[kind] === true) kinds[kind] = true;
  }
  return kinds;
}

function commentFromPayload(value: BackgroundJobPayload[string] | undefined): CommentForGitHub {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.content !== 'string'
  ) {
    throw new NonRetryableError('Job payload is missing the comment');
  }
  return {
    content: value.content,
    authorId: optionalString(value.authorId) ?? null,
    authorName: optionalString(value.authorName),
    commentId: optionalString(value.commentId),
  };
}

function commentPayload(comment: CommentForGitHub): BackgroundJobPayload {
  const payload: BackgroundJobPayload = {};
  for (const [key, entry] of Object.entries(comment)) {
    if (isJsonValue(entry)) payload[key] = entry;
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
  private readonly createClient: ReverseSyncClientFactory;

  constructor(
    private readonly db: Database,
    options: { createClient?: ReverseSyncClientFactory } = {}
  ) {
    this.createClient = options.createClient ?? createGitHubClientForInstallation;
    registerBackgroundJob(REVERSE_SYNC_JOBS.task, async (payload) => {
      await this.syncTaskToGitHub(payloadTaskId(payload), changeKindsFromPayload(payload));
    });
    registerBackgroundJob(REVERSE_SYNC_JOBS.comment, async (payload) => {
      await this.syncCommentToGitHub(payloadTaskId(payload), commentFromPayload(payload.comment));
    });
  }

  /**
   * Push the task's CURRENT values for the given kinds to the linked issue.
   * A deleted (or missing) task closes the issue; otherwise the open/closed
   * state follows the current state category. Nothing is pushed when the
   * task's content already hashes to the link's sync hash (GitHub has it).
   * After writing, the fresh issue content is hashed and stored on the link,
   * so the webhook echo is skipped while genuine GitHub edits still apply.
   */
  async syncTaskToGitHub(taskId: string, kinds: TaskChangesForGitHub): Promise<ReverseSyncResult> {
    const resolved = await this.resolveIssueLink(taskId);
    if ('reason' in resolved) return { synced: false, reason: resolved.reason };
    const { client, ref, linkId } = resolved;

    const current = await this.loadTaskForGitHub(taskId);
    const updates: { title?: string; body?: string; state?: 'open' | 'closed' } = {};
    let labelNames: string[] | null = null;

    if (!current || current.deleted) {
      updates.state = 'closed';
    } else {
      if (current.content.state && resolved.syncHash !== null) {
        const full: IssueContent = { ...current.content, state: current.content.state };
        if (computeIssueSyncHash(full) === resolved.syncHash) {
          return { synced: false, reason: 'Already in sync' };
        }
      }
      if (kinds.title) updates.title = current.content.title;
      if (kinds.description) updates.body = current.content.body;
      if (kinds.state && current.content.state) updates.state = current.content.state;
      if (kinds.labels) labelNames = current.content.labels;
    }

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
      const [user] = await this.db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, comment.authorId));
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
  async syncAssigneesToGitHub(
    _taskId: string,
    _action: 'add' | 'remove',
    _userId: string
  ): Promise<ReverseSyncResult> {
    return { synced: false, reason: 'GitHub username mapping not implemented' };
  }

  /** Bring the linked issue's open/closed state in line with the task (deleted → closed). */
  async closeGitHubIssue(taskId: string): Promise<ReverseSyncResult> {
    return this.syncTaskToGitHub(taskId, { state: true });
  }

  // ============ Background entry points (single retry seam) ============

  /**
   * Queue a push of the given kinds of change. Only the kinds are queued; the
   * job reads the current task when it runs. One pending job per task: a
   * later change merges its kinds into it (and re-runs it if it is running).
   */
  scheduleTaskSync(taskId: string, kinds: TaskChangesForGitHub): void {
    const payload: BackgroundJobPayload = { taskId, rev: randomUUID() };
    for (const kind of CHANGE_KINDS) {
      if (kinds[kind]) payload[kind] = true;
    }
    scheduleBackgroundJob(REVERSE_SYNC_JOBS.task, payload, {
      key: reverseSyncJobKey(taskId),
      coalesce: true,
      context: { taskId },
    });
  }

  scheduleCommentSync(taskId: string, comment: CommentForGitHub): void {
    scheduleBackgroundJob(
      REVERSE_SYNC_JOBS.comment,
      { taskId, comment: commentPayload(comment) },
      { context: { taskId, commentId: comment.commentId } }
    );
  }

  /** The task was deleted or restored: close or reopen the issue, decided when the job runs. */
  scheduleIssueStateSync(taskId: string): void {
    this.scheduleTaskSync(taskId, { state: true });
  }

  // ============ Helpers ============

  private async recordSyncedContent(
    client: ReverseSyncGitHubClient,
    issueNumber: number,
    linkId: string
  ): Promise<void> {
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
        syncHash: externalLinks.syncHash,
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

    const installationId = findInstallationForRepo(
      parseGitHubConfig(row.config),
      ref.owner,
      ref.repo
    );
    if (!installationId) return { reason: 'Repository is no longer linked to this project' };

    const client = await this.createClient(installationId, { owner: ref.owner, repo: ref.repo });
    return { linkId: row.linkId, syncHash: row.syncHash, ref, client };
  }

  /** The task as GitHub would show it, read now (deleted tasks included). */
  private async loadTaskForGitHub(taskId: string): Promise<{
    deleted: boolean;
    content: Omit<IssueContent, 'state'> & { state: IssueContent['state'] | null };
  } | null> {
    const [task] = await this.db
      .select({
        title: tasks.title,
        description: tasks.description,
        stateId: tasks.stateId,
        deletedAt: tasks.deletedAt,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId));
    if (!task) return null;
    const category = await getStateCategory(this.db, task.stateId);
    const labelRows = await this.db
      .select({ name: labels.name })
      .from(taskLabels)
      .innerJoin(labels, eq(taskLabels.labelId, labels.id))
      .where(eq(taskLabels.taskId, taskId));
    return {
      deleted: task.deletedAt !== null,
      content: {
        title: task.title,
        body: task.description ?? '',
        state: category ? (category === 'done' ? 'closed' : 'open') : null,
        labels: labelRows.map((label) => label.name).sort(),
      },
    };
  }
}
