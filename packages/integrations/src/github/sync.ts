import type { Database } from '@flowtask/database';
import { externalLinks, tasks } from '@flowtask/database';
import type { TaskService, TaskWithRelations } from '@flowtask/domain';
import { REALTIME_EVENTS, formatGitHubExternalId } from '@flowtask/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { PublishRealtimeEvent } from '../types.js';
import { notifySlackForTaskEvent, type SlackTaskEvent } from '../slack/task-events.js';
import { createGitHubClientForInstallation } from './client.js';
import type { GitHubRepoTarget } from './integration-store.js';
import { computeIssueSyncHash } from './sync-hash.js';
import { findFirstStateByCategory, getStateCategory, positionAtEndOfState } from './task-lookup.js';
import { issueContentFrom, mapLabelsToPriority, type IssueContent } from './webhook.js';

export interface GitHubSyncDeps {
  db: Database;
  taskService: TaskService;
  /** Realtime publisher (apps/api sse `publishEvent`). Defaults to a no-op. */
  publish?: PublishRealtimeEvent;
  /** Slack notifier. Defaults to notifySlackForTaskEvent. */
  notifySlack?: (event: SlackTaskEvent) => void;
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

class LinkClaimLostError extends Error {}

/**
 * Limits concurrent link claims: a claim holds one pooled connection for its
 * advisory-locked transaction while TaskService.create uses another.
 */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      // The releasing caller hands its slot over directly (see finally).
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}

const claimSemaphore = new Semaphore(2);
const INITIAL_SYNC_MAX_PAGES = 10;

/**
 * GitHub → FlowTask sync (issues to tasks). FlowTask → GitHub lives in
 * GitHubReverseSyncService.
 */
export class GitHubSyncService {
  private readonly db: Database;
  private readonly taskService: TaskService;
  private readonly publish: PublishRealtimeEvent;
  private readonly notifySlack: (event: SlackTaskEvent) => void;

  constructor(deps: GitHubSyncDeps) {
    this.db = deps.db;
    this.taskService = deps.taskService;
    this.publish = deps.publish ?? (() => {});
    this.notifySlack = deps.notifySlack ?? notifySlackForTaskEvent;
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
          result.errors.push(`Issue #${issue.number}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    return this.applyIssue(target, { number: issue.number, url: issue.html_url, content: issueContentFrom(issue) }, options);
  }

  /** Apply issue content to its linked task, creating the task when allowed. */
  async applyIssue(
    target: GitHubRepoTarget,
    issue: IssueSnapshot,
    options: { createIfMissing: boolean }
  ): Promise<IssueSyncResult> {
    const externalId = formatGitHubExternalId(target.repo.owner, target.repo.repo, issue.number);
    const syncHash = computeIssueSyncHash(issue.content);

    const claim = await this.claimIssueLink(target, externalId, issue, syncHash, options.createIfMissing);

    if (claim.kind === 'missing') {
      return { action: 'ignored', taskId: null };
    }

    if (claim.kind === 'created') {
      this.publish(target.workspaceId, REALTIME_EVENTS.TASK_CREATED, claim.task);
      this.notifySlack({ type: 'task.created', taskId: claim.task.id, actorLabel: 'GitHub' });
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

    const targetState = await this.resolveTargetState(target.projectId, current.value.stateId, issue.content.state);
    const priority = mapLabelsToPriority(issue.content.labels);

    const updated = await this.taskService.update(claim.taskId, {
      title: issue.content.title,
      description: issue.content.body,
      ...(priority ? { priority } : {}),
      ...(targetState ? { stateId: targetState.id, position: targetState.position } : {}),
      updatedBy: null,
      skipGitHubSync: true,
    });
    if (!updated.ok) throw updated.error;

    await this.db
      .update(externalLinks)
      .set({ syncHash, lastSyncedAt: new Date(), externalUrl: issue.url })
      .where(eq(externalLinks.id, claim.linkId));

    if (targetState) {
      this.publish(target.workspaceId, REALTIME_EVENTS.TASK_MOVED, updated.value);
      this.notifySlack({ type: 'task.state_changed', taskId: claim.taskId, toStateId: targetState.id, actorLabel: 'GitHub' });
    } else {
      this.publish(target.workspaceId, REALTIME_EVENTS.TASK_UPDATED, updated.value);
    }
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
  ): Promise<{ id: string; position: string } | null> {
    const category = await getStateCategory(this.db, currentStateId);
    const wanted = issueState === 'closed' ? 'done' : 'backlog';
    if (issueState === 'closed' && category === 'done') return null;
    if (issueState === 'open' && category !== 'done') return null;
    const state = await findFirstStateByCategory(this.db, projectId, wanted);
    if (!state || state.id === currentStateId) return null;
    return { id: state.id, position: await positionAtEndOfState(this.db, projectId, state.id) };
  }

  /**
   * Find the task linked to an issue, or create task + link atomically.
   *
   * An advisory transaction lock on (integration, externalId) serializes
   * concurrent deliveries for the same issue (e.g. `opened` + `labeled`). The
   * link is inserted with ON CONFLICT DO NOTHING and the task only survives
   * when that insert wins; otherwise (or on any failure) the freshly created
   * task is removed, so there are neither duplicates nor orphans.
   */
  private async claimIssueLink(
    target: GitHubRepoTarget,
    externalId: string,
    issue: IssueSnapshot,
    syncHash: string,
    createIfMissing: boolean
  ): Promise<LinkClaim> {
    const findExisting = async (): Promise<LinkClaim | null> => {
      const [existing] = await this.db
        .select({ id: externalLinks.id, taskId: externalLinks.taskId, syncHash: externalLinks.syncHash })
        .from(externalLinks)
        .where(
          and(
            eq(externalLinks.integrationId, target.integrationId),
            eq(externalLinks.externalType, 'github_issue'),
            eq(externalLinks.externalId, externalId)
          )
        );
      return existing ? { kind: 'existing', linkId: existing.id, taskId: existing.taskId, syncHash: existing.syncHash } : null;
    };

    // Fast path without locking.
    const existing = await findExisting();
    if (existing) return existing;
    if (!createIfMissing) return { kind: 'missing' };

    return claimSemaphore.run(async () => {
      let createdTaskId: string | null = null;
      try {
        return await this.db.transaction(async (tx): Promise<LinkClaim> => {
          const lockKey = `github-issue-link:${target.integrationId}:${externalId}`;
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

          const [locked] = await tx
            .select({ id: externalLinks.id, taskId: externalLinks.taskId, syncHash: externalLinks.syncHash })
            .from(externalLinks)
            .where(
              and(
                eq(externalLinks.integrationId, target.integrationId),
                eq(externalLinks.externalType, 'github_issue'),
                eq(externalLinks.externalId, externalId)
              )
            );
          if (locked) {
            return { kind: 'existing', linkId: locked.id, taskId: locked.taskId, syncHash: locked.syncHash };
          }

          const initialState =
            issue.content.state === 'closed' ? await findFirstStateByCategory(this.db, target.projectId, 'done') : null;
          const priority = mapLabelsToPriority(issue.content.labels);
          const created = await this.taskService.create({
            projectId: target.projectId,
            title: issue.content.title,
            description: issue.content.body || undefined,
            ...(priority ? { priority } : {}),
            ...(initialState ? { stateId: initialState.id } : {}),
            createdBy: null,
          });
          if (!created.ok) throw created.error;
          createdTaskId = created.value.id;

          const [inserted] = await tx
            .insert(externalLinks)
            .values({
              integrationId: target.integrationId,
              taskId: created.value.id,
              externalType: 'github_issue',
              externalId,
              externalUrl: issue.url,
              syncHash,
              lastSyncedAt: new Date(),
            })
            .onConflictDoNothing({
              target: [externalLinks.integrationId, externalLinks.externalType, externalLinks.externalId],
            })
            .returning({ id: externalLinks.id });
          if (!inserted) throw new LinkClaimLostError('Issue link already claimed');

          return { kind: 'created', task: created.value };
        });
      } catch (error) {
        if (createdTaskId) {
          await this.db.delete(tasks).where(eq(tasks.id, createdTaskId));
        }
        if (error instanceof LinkClaimLostError) {
          const winner = await findExisting();
          if (winner) return winner;
        }
        throw error;
      }
    });
  }
}
