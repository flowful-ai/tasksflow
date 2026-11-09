import type { Database } from '../../db/index.js';
import { externalLinks } from '../../db/index.js';
import { TaskService, type TaskWithRelations } from '../../domain/index.js';
import { formatGitHubExternalId } from '@flowtask/shared';
import { and, eq, sql } from 'drizzle-orm';
import { createGitHubClientForInstallation } from './client.js';
import type { GitHubRepoTarget } from './integration-store.js';
import { computeIssueSyncHash } from './sync-hash.js';
import { findFirstStateByCategory, getStateCategory } from './task-lookup.js';
import { issueContentFrom, mapLabelsToPriority, type IssueContent } from './webhook.js';

export interface GitHubSyncDeps {
  db: Database;
  taskService: TaskService;
}

export type IssueSyncAction = 'created' | 'updated' | 'unchanged' | 'ignored';

export interface IssueSyncResult {
  action: IssueSyncAction;
  taskId: string | null;
}

export interface InitialSyncResult {
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

interface IssueSnapshot {
  number: number;
  url: string;
  content: IssueContent;
}

type LinkClaim =
  | { kind: 'existing'; linkId: string; taskId: string; syncHash: string | null }
  | { kind: 'created'; task: TaskWithRelations }
  | { kind: 'missing' };

const INITIAL_SYNC_MAX_PAGES = 10;

/**
 * GitHub → FlowTask sync (issues to tasks). FlowTask → GitHub lives in
 * GitHubReverseSyncService. Writes go through TaskService with origin
 * 'github', so realtime and Slack follow from its domain events.
 */
export class GitHubSyncService {
  private readonly db: Database;
  private readonly taskService: TaskService;

  constructor(deps: GitHubSyncDeps) {
    this.db = deps.db;
    this.taskService = deps.taskService;
  }

  /** Import all open issues of a linked repository. */
  async initialSync(target: GitHubRepoTarget): Promise<InitialSyncResult> {
    const result: InitialSyncResult = { created: 0, updated: 0, unchanged: 0, errors: [] };
    const client = await createGitHubClientForInstallation(target.repo.installationId, target.repo);

    for (let page = 1; page <= INITIAL_SYNC_MAX_PAGES; page++) {
      const issues = await client.listIssues({ state: 'open', per_page: 100, page });
      for (const issue of issues) {
        // The issues endpoint also returns pull requests; those aren't tasks.
        if (issue.pull_request) continue;
        try {
          const synced = await this.applyIssue(
            target,
            { number: issue.number, url: issue.html_url, content: issueContentFrom(issue) },
            { createIfMissing: true }
          );
          if (synced.action === 'created') result.created++;
          else if (synced.action === 'updated') result.updated++;
          else if (synced.action === 'unchanged') result.unchanged++;
        } catch (error) {
          result.errors.push(
            `Issue #${issue.number}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
      if (issues.length < 100) break;
    }
    return result;
  }

  /** Fetch the current state of an issue from GitHub and apply it. */
  async syncIssueFromGitHub(
    target: GitHubRepoTarget,
    issueNumber: number,
    options: { createIfMissing: boolean }
  ): Promise<IssueSyncResult> {
    const client = await createGitHubClientForInstallation(target.repo.installationId, target.repo);
    const issue = await client.getIssue(issueNumber);
    if (issue.pull_request) {
      return { action: 'ignored', taskId: null };
    }
    return this.applyIssue(
      target,
      { number: issue.number, url: issue.html_url, content: issueContentFrom(issue) },
      options
    );
  }

  /** Apply issue content to its linked task, creating the task when allowed. */
  async applyIssue(
    target: GitHubRepoTarget,
    issue: IssueSnapshot,
    options: { createIfMissing: boolean }
  ): Promise<IssueSyncResult> {
    const externalId = formatGitHubExternalId(target.repo.owner, target.repo.repo, issue.number);
    const syncHash = computeIssueSyncHash(issue.content);

    const claim = await this.claimIssueLink(
      target,
      externalId,
      issue,
      syncHash,
      options.createIfMissing
    );

    if (claim.kind === 'missing') {
      return { action: 'ignored', taskId: null };
    }

    if (claim.kind === 'created') {
      return { action: 'created', taskId: claim.task.id };
    }

    // Echo of our own write, or a duplicate delivery: nothing changed.
    if (claim.syncHash === syncHash) {
      return { action: 'unchanged', taskId: claim.taskId };
    }

    const current = await this.taskService.getById(claim.taskId);
    if (!current.ok) throw current.error;
    if (current.value.deletedAt) {
      return { action: 'ignored', taskId: claim.taskId };
    }

    const targetState = await this.resolveTargetState(
      target.projectId,
      current.value.stateId,
      issue.content.state
    );
    const priority = mapLabelsToPriority(issue.content.labels);

    const updated = await this.taskService.update(claim.taskId, {
      title: issue.content.title,
      description: issue.content.body,
      ...(priority ? { priority } : {}),
      ...(targetState ? { stateId: targetState.id } : {}),
      updatedBy: null,
      skipGitHubSync: true,
    });
    if (!updated.ok) throw updated.error;

    await this.db
      .update(externalLinks)
      .set({ syncHash, lastSyncedAt: new Date(), externalUrl: issue.url })
      .where(eq(externalLinks.id, claim.linkId));

    // Realtime and Slack run off the task.updated domain event (origin 'github').
    return { action: 'updated', taskId: claim.taskId };
  }

  /**
   * Closed issue → first `done` state; reopened issue → first `backlog` state.
   * Returns null when the task is already in a matching category.
   */
  async resolveTargetState(
    projectId: string,
    currentStateId: string | null,
    issueState: 'open' | 'closed'
  ): Promise<{ id: string } | null> {
    const category = await getStateCategory(this.db, currentStateId);
    const wanted = issueState === 'closed' ? 'done' : 'backlog';
    if (issueState === 'closed' && category === 'done') return null;
    if (issueState === 'open' && category !== 'done') return null;
    const state = await findFirstStateByCategory(this.db, projectId, wanted);
    if (!state || state.id === currentStateId) return null;
    // TaskService.update appends the task to the end of the new column.
    return { id: state.id };
  }

  /**
   * Find the task linked to an issue, or create task + link atomically.
   *
   * One transaction: an advisory lock on (integration, externalId) serializes
   * concurrent deliveries for the same issue (e.g. `opened` + `labeled`), the
   * task is created on the same transaction (TaskService.transaction), and the
   * link insert commits with it. A loser of the lock sees the winner's link and
   * returns it, so there are neither duplicates nor orphans. The task.created
   * event is only emitted once the transaction has committed.
   */
  private async claimIssueLink(
    target: GitHubRepoTarget,
    externalId: string,
    issue: IssueSnapshot,
    syncHash: string,
    createIfMissing: boolean
  ): Promise<LinkClaim> {
    const linkFilter = and(
      eq(externalLinks.integrationId, target.integrationId),
      eq(externalLinks.externalType, 'github_issue'),
      eq(externalLinks.externalId, externalId)
    );
    const linkColumns = {
      id: externalLinks.id,
      taskId: externalLinks.taskId,
      syncHash: externalLinks.syncHash,
    };

    // Fast path without locking.
    const [existing] = await this.db.select(linkColumns).from(externalLinks).where(linkFilter);
    if (existing)
      return {
        kind: 'existing',
        linkId: existing.id,
        taskId: existing.taskId,
        syncHash: existing.syncHash,
      };
    if (!createIfMissing) return { kind: 'missing' };

    return TaskService.transaction(this.db, async (taskService, tx): Promise<LinkClaim> => {
      const lockKey = `github-issue-link:${target.integrationId}:${externalId}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

      const [locked] = await tx.select(linkColumns).from(externalLinks).where(linkFilter);
      if (locked) {
        return {
          kind: 'existing',
          linkId: locked.id,
          taskId: locked.taskId,
          syncHash: locked.syncHash,
        };
      }

      const initialState =
        issue.content.state === 'closed'
          ? await findFirstStateByCategory(tx, target.projectId, 'done')
          : null;
      const priority = mapLabelsToPriority(issue.content.labels);
      const created = await taskService.create({
        projectId: target.projectId,
        title: issue.content.title,
        description: issue.content.body || undefined,
        ...(priority ? { priority } : {}),
        ...(initialState ? { stateId: initialState.id } : {}),
        createdBy: null,
        skipGitHubSync: true,
      });
      if (!created.ok) throw created.error;

      await tx.insert(externalLinks).values({
        integrationId: target.integrationId,
        taskId: created.value.id,
        externalType: 'github_issue',
        externalId,
        externalUrl: issue.url,
        syncHash,
        lastSyncedAt: new Date(),
      });

      return { kind: 'created', task: created.value };
    });
  }
}
