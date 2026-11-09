/**
 * Database-backed tests for idempotent GitHub → FlowTask sync.
 * Skipped unless TEST_DATABASE_URL points at a database with the current schema
 * (e.g. `bunx drizzle-kit push` from apps/api).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createDatabase,
  externalLinks,
  projectIntegrations,
  projects,
  taskStates,
  tasks,
  workspaces,
  type Database,
} from '../../db/index.js';
import {
  CommentService,
  TaskService,
  domainEvents,
  type TaskCreatedEvent,
  type TaskUpdatedEvent,
} from '../../domain/index.js';
import { formatGitHubExternalId, parseTaskReferences } from '@flowtask/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { GitHubRepoTarget } from './integration-store.js';
import { findGitHubTargetsForRepo } from './integration-store.js';
import { GitHubSyncService } from './sync.js';
import { resolveTaskReferencesInProject } from './task-lookup.js';
import { GitHubWebhookProcessor } from './webhook-processor.js';
import type { GitHubWebhookAction, IssueContent } from './webhook.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

interface PublishedEvent {
  workspaceId: string;
  event: string;
  data: object;
}

describeDb('GitHub sync (database)', () => {
  let db: Database;
  let workspaceId: string;
  let projectId: string;
  let backlogStateId: string;
  let doneStateId: string;
  let apiTarget: GitHubRepoTarget;
  let webTarget: GitHubRepoTarget;
  const published: PublishedEvent[] = [];
  const created: TaskCreatedEvent[] = [];
  const updated: TaskUpdatedEvent[] = [];
  const unsubscribe = [
    domainEvents.on('task.created', (event) => void created.push(event)),
    domainEvents.on('task.updated', (event) => void updated.push(event)),
  ];
  let sync: GitHubSyncService;

  const suffix = crypto.randomUUID().slice(0, 8);
  const owner = `acme-${suffix}`;

  const content = (overrides: Partial<IssueContent> = {}): IssueContent => ({
    title: 'Login is broken',
    body: 'Steps to reproduce',
    state: 'open',
    labels: ['bug'],
    ...overrides,
  });

  const issueUrl = (repo: string, n: number) => `https://github.com/${owner}/${repo}/issues/${n}`;

  async function liveTasksFor(target: GitHubRepoTarget, number: number) {
    return db
      .select({ taskId: externalLinks.taskId, stateId: tasks.stateId, title: tasks.title })
      .from(externalLinks)
      .innerJoin(tasks, eq(externalLinks.taskId, tasks.id))
      .where(
        and(
          eq(externalLinks.integrationId, target.integrationId),
          eq(
            externalLinks.externalId,
            formatGitHubExternalId(target.repo.owner, target.repo.repo, number)
          ),
          isNull(tasks.deletedAt)
        )
      );
  }

  async function projectTaskCount(): Promise<number> {
    const rows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.projectId, projectId));
    return rows.length;
  }

  beforeAll(async () => {
    db = createDatabase(TEST_DATABASE_URL);
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Sync test', slug: `sync-test-${suffix}` })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');
    workspaceId = workspace.id;

    const [project] = await db
      .insert(projects)
      .values({ workspaceId, name: 'Core', identifier: `T${suffix.slice(0, 4).toUpperCase()}` })
      .returning();
    if (!project) throw new Error('project insert failed');
    projectId = project.id;

    const states = await db
      .insert(taskStates)
      .values([
        { projectId, name: 'Backlog', category: 'backlog', position: 'a0' },
        { projectId, name: 'In Progress', category: 'in_progress', position: 'a1' },
        { projectId, name: 'Done', category: 'done', position: 'a2' },
        { projectId, name: 'Cancelled', category: 'done', position: 'a3' },
      ])
      .returning();
    backlogStateId = states.find((s) => s.name === 'Backlog')?.id ?? '';
    doneStateId = states.find((s) => s.name === 'Done')?.id ?? '';

    await db.insert(projectIntegrations).values({
      projectId,
      integrationType: 'github',
      config: {
        repositories: [
          { owner, repo: 'api', installationId: 101 },
          { owner, repo: 'web', installationId: 101 },
        ],
      },
    });

    const [api] = await findGitHubTargetsForRepo(db, owner, 'api');
    const [web] = await findGitHubTargetsForRepo(db, owner.toUpperCase(), 'WEB');
    if (!api || !web) throw new Error('targets not found');
    apiTarget = api;
    webTarget = web;

    sync = new GitHubSyncService({
      db,
      taskService: new TaskService(db),
    });
  });

  afterAll(async () => {
    for (const off of unsubscribe) off();
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  });

  test('finds integrations by repo with the JSONB query, and only exact repos', async () => {
    expect(apiTarget.repo.installationId).toBe(101);
    expect(await findGitHubTargetsForRepo(db, owner, 'ap')).toEqual([]);
    expect(await findGitHubTargetsForRepo(db, 'someone-else', 'api')).toEqual([]);
  });

  test('two repos with the same issue number create two tasks', async () => {
    const a = await sync.applyIssue(
      apiTarget,
      { number: 1, url: issueUrl('api', 1), content: content() },
      { createIfMissing: true }
    );
    const b = await sync.applyIssue(
      webTarget,
      { number: 1, url: issueUrl('web', 1), content: content() },
      { createIfMissing: true }
    );

    expect(a.action).toBe('created');
    expect(b.action).toBe('created');
    expect(a.taskId).not.toBe(b.taskId);
    expect(await liveTasksFor(apiTarget, 1)).toHaveLength(1);
    expect(await liveTasksFor(webTarget, 1)).toHaveLength(1);

    // Realtime/Slack follow from the domain event, emitted after the claim commits.
    await domainEvents.idle();
    const createdEvent = created.find((e) => e.task.id === a.taskId);
    expect(createdEvent?.workspaceId).toBe(workspaceId);
    expect(createdEvent?.projectId).toBe(projectId);
    expect(createdEvent?.origin).toBe('github');
  });

  test('a duplicate delivery is a no-op', async () => {
    const before = await projectTaskCount();
    const again = await sync.applyIssue(
      apiTarget,
      { number: 1, url: issueUrl('api', 1), content: content() },
      { createIfMissing: true }
    );
    expect(again.action).toBe('unchanged');
    expect(await projectTaskCount()).toBe(before);
  });

  test('concurrent opened + labeled deliveries create exactly one task and no orphans', async () => {
    const before = await projectTaskCount();
    const issue = { number: 2, url: issueUrl('api', 2) };
    const results = await Promise.all([
      sync.applyIssue(
        apiTarget,
        { ...issue, content: content({ title: 'Race' }) },
        { createIfMissing: true }
      ),
      sync.applyIssue(
        apiTarget,
        { ...issue, content: content({ title: 'Race', labels: ['bug', 'p1'] }) },
        { createIfMissing: true }
      ),
      sync.applyIssue(
        apiTarget,
        { ...issue, content: content({ title: 'Race' }) },
        { createIfMissing: true }
      ),
    ]);

    expect(results.filter((r) => r.action === 'created')).toHaveLength(1);
    expect(new Set(results.map((r) => r.taskId)).size).toBe(1);
    expect(await liveTasksFor(apiTarget, 2)).toHaveLength(1);
    expect(await projectTaskCount()).toBe(before + 1);
  });

  test('a genuine edit right after a sync is applied (no time-window drop)', async () => {
    const result = await sync.applyIssue(
      apiTarget,
      {
        number: 1,
        url: issueUrl('api', 1),
        content: content({ title: 'Login is broken on Safari' }),
      },
      { createIfMissing: true }
    );
    expect(result.action).toBe('updated');
    const [task] = await liveTasksFor(apiTarget, 1);
    expect(task?.title).toBe('Login is broken on Safari');
  });

  test('closing moves the task to the first done state; reopening moves it to backlog', async () => {
    await sync.applyIssue(
      apiTarget,
      {
        number: 1,
        url: issueUrl('api', 1),
        content: content({ title: 'Login is broken on Safari', state: 'closed' }),
      },
      { createIfMissing: true }
    );
    let [task] = await liveTasksFor(apiTarget, 1);
    expect(task?.stateId).toBe(doneStateId);
    await domainEvents.idle();
    expect(
      updated.some(
        (e) =>
          e.task.id === task?.taskId &&
          e.origin === 'github' &&
          e.changes.some((c) => c.field === 'stateId')
      )
    ).toBe(true);

    await sync.applyIssue(
      apiTarget,
      {
        number: 1,
        url: issueUrl('api', 1),
        content: content({ title: 'Login is broken on Safari', state: 'open' }),
      },
      { createIfMissing: true }
    );
    [task] = await liveTasksFor(apiTarget, 1);
    expect(task?.stateId).toBe(backlogStateId);
  });

  test('events on unlinked issues do not create tasks when creation is not allowed', async () => {
    const before = await projectTaskCount();
    const result = await sync.applyIssue(
      apiTarget,
      { number: 3, url: issueUrl('api', 3), content: content({ state: 'closed' }) },
      { createIfMissing: false }
    );
    expect(result.action).toBe('ignored');
    expect(await projectTaskCount()).toBe(before);
  });

  test('webhook processor: installation must match, app echoes are skipped, comments sync with SSE', async () => {
    const processor = new GitHubWebhookProcessor({
      db,
      taskService: new TaskService(db),
      commentService: new CommentService(db),
      publish: (wsId, event, data) => published.push({ workspaceId: wsId, event, data }),
      appId: 4242,
    });
    const commentEvent = (overrides: {
      installationId?: number;
      viaAppId?: number | null;
      id?: string;
    }): Extract<GitHubWebhookAction, { kind: 'issue_comment' }> => ({
      kind: 'issue_comment',
      action: 'created',
      repo: { owner, repo: 'api' },
      installationId: overrides.installationId ?? 101,
      issueNumber: 1,
      comment: {
        id: overrides.id ?? `c-${suffix}`,
        body: 'Looks good',
        authorLogin: 'octocat',
        authorId: 1,
        viaAppId: overrides.viaAppId ?? null,
      },
    });

    const mismatch = await processor.process(apiTarget, commentEvent({ installationId: 999 }));
    expect(mismatch).toMatchObject({ status: 'ignored', reason: 'Installation mismatch' });

    const echo = await processor.process(
      apiTarget,
      commentEvent({ viaAppId: 4242, id: `echo-${suffix}` })
    );
    expect(echo).toMatchObject({ status: 'ignored', reason: 'Comment posted by FlowTask' });

    const synced = await processor.process(apiTarget, commentEvent({}));
    expect(synced).toMatchObject({ status: 'processed', action: 'comment_synced' });
    expect(published.find((e) => e.event === 'comment:created')?.data).toMatchObject({ projectId });

    const duplicate = await processor.process(apiTarget, commentEvent({}));
    expect(duplicate).toMatchObject({ status: 'ignored', reason: 'Comment already synced' });
  });

  test('task references resolve to tasks of this project only', async () => {
    const [task] = await db
      .select({ id: tasks.id, sequenceNumber: tasks.sequenceNumber })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .limit(1);
    const [project] = await db
      .select({ identifier: projects.identifier })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!task || !project) throw new Error('seed missing');

    const refs = parseTaskReferences(
      `feature/${project.identifier.toLowerCase()}-${task.sequenceNumber}-fix OTHER-${task.sequenceNumber}`
    );
    expect(await resolveTaskReferencesInProject(db, projectId, refs)).toEqual([task.id]);
    expect(
      await resolveTaskReferencesInProject(db, projectId, parseTaskReferences('NOPE-1'))
    ).toEqual([]);
  });
});
