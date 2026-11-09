import type { Database } from '../../db/index.js';
import { accounts, externalLinks, workspaceMembers } from '../../db/index.js';
import type { CommentService, TaskService } from '../../domain/index.js';
import { REALTIME_EVENTS, formatGitHubExternalId, parseTaskReferences } from '@flowtask/shared';
import { and, eq } from 'drizzle-orm';
import type { PublishRealtimeEvent } from '../types.js';
import { getGitHubAppId } from './client.js';
import type { GitHubRepoTarget } from './integration-store.js';
import { GitHubSyncService } from './sync.js';
import { findFirstStateByCategory, getStateCategory, resolveTaskReferencesInProject } from './task-lookup.js';
import type { GitHubWebhookAction } from './webhook.js';

export interface GitHubWebhookProcessorDeps {
  db: Database;
  taskService: TaskService;
  commentService: CommentService;
  /** Realtime publisher for comment and link changes (task changes publish via domain events). */
  publish?: PublishRealtimeEvent;
  /** Our GitHub App id, used to recognise echoes of our own writes. Defaults to GITHUB_APP_ID. */
  appId?: number | null;
}

export interface WebhookTargetResult {
  integrationId: string;
  projectId: string;
  status: 'processed' | 'ignored';
  action?: string;
  taskId?: string | null;
  reason?: string;
}

type ProcessableAction = Exclude<GitHubWebhookAction, { kind: 'ignore' }>;

/**
 * Applies one classified GitHub delivery to one matching project integration.
 * The API route handles signature checks, dedupe and target lookup, and calls
 * `process` for every matching project.
 */
export class GitHubWebhookProcessor {
  private readonly db: Database;
  private readonly taskService: TaskService;
  private readonly commentService: CommentService;
  private readonly publish: PublishRealtimeEvent;
  private readonly appId: number | null;
  private readonly sync: GitHubSyncService;

  constructor(deps: GitHubWebhookProcessorDeps) {
    this.db = deps.db;
    this.taskService = deps.taskService;
    this.commentService = deps.commentService;
    this.publish = deps.publish ?? (() => {});
    this.appId = deps.appId === undefined ? getGitHubAppId() : deps.appId;
    this.sync = new GitHubSyncService({
      db: deps.db,
      taskService: deps.taskService,
    });
  }

  async process(target: GitHubRepoTarget, action: ProcessableAction): Promise<WebhookTargetResult> {
    const base = { integrationId: target.integrationId, projectId: target.projectId };

    // The delivery must come from the installation this project linked the repo with.
    if (action.installationId !== target.repo.installationId) {
      return { ...base, status: 'ignored', reason: 'Installation mismatch' };
    }

    switch (action.kind) {
      case 'issue':
        return { ...base, ...(await this.processIssue(target, action)) };
      case 'issue_comment':
        return { ...base, ...(await this.processComment(target, action)) };
      case 'pull_request':
        return { ...base, ...(await this.processPullRequest(target, action)) };
    }
  }

  private async processIssue(
    target: GitHubRepoTarget,
    action: Extract<ProcessableAction, { kind: 'issue' }>
  ): Promise<Omit<WebhookTargetResult, 'integrationId' | 'projectId'>> {
    // Issues FlowTask itself opened are linked by the creating request, not imported again.
    const openedByUs = this.appId !== null && action.createdByAppId === this.appId;
    const createIfMissing = action.action !== 'closed' && !openedByUs;
    const result = await this.sync.syncIssueFromGitHub(target, action.issueNumber, { createIfMissing });
    return {
      status: result.action === 'ignored' || result.action === 'unchanged' ? 'ignored' : 'processed',
      action: result.action,
      taskId: result.taskId,
      ...(result.action === 'unchanged' ? { reason: 'Content matches last sync' } : {}),
    };
  }

  private async findIssueTaskId(target: GitHubRepoTarget, issueNumber: number): Promise<string | null> {
    const [link] = await this.db
      .select({ taskId: externalLinks.taskId })
      .from(externalLinks)
      .where(
        and(
          eq(externalLinks.integrationId, target.integrationId),
          eq(externalLinks.externalType, 'github_issue'),
          eq(externalLinks.externalId, formatGitHubExternalId(target.repo.owner, target.repo.repo, issueNumber))
        )
      );
    return link?.taskId ?? null;
  }

  private async processComment(
    target: GitHubRepoTarget,
    action: Extract<ProcessableAction, { kind: 'issue_comment' }>
  ): Promise<Omit<WebhookTargetResult, 'integrationId' | 'projectId'>> {
    const taskId = await this.findIssueTaskId(target, action.issueNumber);
    if (!taskId) {
      return { status: 'ignored', reason: 'Comment on unlinked issue' };
    }

    // Comments posted by FlowTask (reverse sync) come back as webhooks; skip them.
    if (action.action !== 'deleted' && this.appId !== null && action.comment.viaAppId === this.appId) {
      return { status: 'ignored', reason: 'Comment posted by FlowTask', taskId };
    }

    const { comment } = action;

    if (action.action === 'created') {
      const existing = await this.commentService.findByExternalId(comment.id);
      if (!existing.ok) throw existing.error;
      if (existing.value) {
        return { status: 'ignored', reason: 'Comment already synced', taskId };
      }

      // Attribute to the workspace member whose linked GitHub account wrote it, if any.
      const [matchedAccount] = await this.db
        .select({ userId: accounts.userId })
        .from(accounts)
        .innerJoin(workspaceMembers, eq(accounts.userId, workspaceMembers.userId))
        .where(
          and(
            eq(accounts.providerId, 'github'),
            eq(accounts.accountId, comment.authorId.toString()),
            eq(workspaceMembers.workspaceId, target.workspaceId)
          )
        );

      const created = await this.commentService.create({
        taskId,
        userId: matchedAccount?.userId ?? null,
        content: matchedAccount ? comment.body : `**@${comment.authorLogin}** commented on GitHub:\n\n${comment.body}`,
        externalCommentId: comment.id,
        ...(matchedAccount ? {} : { actorLabel: `@${comment.authorLogin} on GitHub` }),
      });
      if (!created.ok) throw created.error;

      this.publish(target.workspaceId, REALTIME_EVENTS.COMMENT_CREATED, {
        taskId,
        projectId: target.projectId,
        comment: created.value,
      });
      return { status: 'processed', action: 'comment_synced', taskId };
    }

    if (action.action === 'edited') {
      const updated = await this.commentService.updateExternal(comment.id, comment.body);
      if (!updated.ok) throw updated.error;
      if (!updated.value) {
        return { status: 'ignored', reason: 'Comment not found for update', taskId };
      }
      this.publish(target.workspaceId, REALTIME_EVENTS.COMMENT_UPDATED, {
        taskId,
        projectId: target.projectId,
        comment: updated.value,
      });
      return { status: 'processed', action: 'comment_updated', taskId };
    }

    const existing = await this.commentService.findByExternalId(comment.id);
    if (!existing.ok) throw existing.error;
    const deleted = await this.commentService.deleteExternal(comment.id);
    if (!deleted.ok) throw deleted.error;
    if (existing.value) {
      this.publish(target.workspaceId, REALTIME_EVENTS.COMMENT_DELETED, {
        taskId,
        projectId: target.projectId,
        commentId: existing.value.id,
      });
    }
    return { status: 'processed', action: 'comment_deleted', taskId };
  }

  private async processPullRequest(
    target: GitHubRepoTarget,
    action: Extract<ProcessableAction, { kind: 'pull_request' }>
  ): Promise<Omit<WebhookTargetResult, 'integrationId' | 'projectId'>> {
    const { pr } = action;
    const externalId = formatGitHubExternalId(target.repo.owner, target.repo.repo, pr.number);

    // Task references (FLOW-123) in the title, body or branch name, resolved within this project.
    const refs = parseTaskReferences(`${pr.title}\n${pr.body}\n${pr.branch}`);
    const referencedTaskIds = await resolveTaskReferencesInProject(this.db, target.projectId, refs);

    // A PR links to one task per project (unique external link); the first reference wins.
    const firstReferenced = referencedTaskIds[0];
    if (firstReferenced && action.action !== 'closed') {
      const [inserted] = await this.db
        .insert(externalLinks)
        .values({
          integrationId: target.integrationId,
          taskId: firstReferenced,
          externalType: 'github_pr',
          externalId,
          externalUrl: pr.url,
          lastSyncedAt: new Date(),
        })
        .onConflictDoNothing({
          target: [externalLinks.integrationId, externalLinks.externalType, externalLinks.externalId],
        })
        .returning({ id: externalLinks.id });
      if (inserted) {
        await this.publishTaskUpdated(target, firstReferenced);
        return { status: 'processed', action: 'pr_linked', taskId: firstReferenced };
      }
      return { status: 'ignored', reason: 'Pull request already linked', taskId: firstReferenced };
    }

    if (action.action === 'closed' && pr.merged) {
      // Merged PR: move the linked (or referenced) task to done. Never treat the PR number as an issue.
      const [link] = await this.db
        .select({ taskId: externalLinks.taskId })
        .from(externalLinks)
        .where(
          and(
            eq(externalLinks.integrationId, target.integrationId),
            eq(externalLinks.externalType, 'github_pr'),
            eq(externalLinks.externalId, externalId)
          )
        );
      const taskId = link?.taskId ?? firstReferenced;
      if (!taskId) {
        return { status: 'ignored', reason: 'Merged PR is not linked to a task' };
      }
      const moved = await this.moveToDone(target, taskId);
      return moved
        ? { status: 'processed', action: 'task_completed', taskId }
        : { status: 'ignored', reason: 'Task already done', taskId };
    }

    return { status: 'ignored', reason: 'No task reference' };
  }

  private async moveToDone(target: GitHubRepoTarget, taskId: string): Promise<boolean> {
    const current = await this.taskService.getById(taskId);
    if (!current.ok || current.value.deletedAt || current.value.projectId !== target.projectId) return false;
    if ((await getStateCategory(this.db, current.value.stateId)) === 'done') return false;
    const doneState = await findFirstStateByCategory(this.db, target.projectId, 'done');
    if (!doneState) return false;

    const moved = await this.taskService.move(taskId, {
      stateId: doneState.id,
      movedBy: null,
      skipGitHubSync: true,
    });
    if (!moved.ok) throw moved.error;
    return true;
  }

  private async publishTaskUpdated(target: GitHubRepoTarget, taskId: string): Promise<void> {
    const task = await this.taskService.getById(taskId);
    if (task.ok) {
      this.publish(target.workspaceId, REALTIME_EVENTS.TASK_UPDATED, task.value);
    }
  }
}
