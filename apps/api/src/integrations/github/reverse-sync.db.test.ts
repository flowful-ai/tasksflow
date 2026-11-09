/**
 * Database-backed tests for FlowTask → GitHub reverse sync through the job
 * queue, with a fake GitHub client. Skipped unless TEST_DATABASE_URL is set.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, isNull } from 'drizzle-orm';
import { formatGitHubExternalId } from '@flowtask/shared';
import {
  createDatabase,
  externalLinks,
  jobs,
  labels,
  projectIntegrations,
  projects,
  taskLabels,
  taskStates,
  tasks,
  workspaces,
  type Database,
} from '../../db/index.js';
import { createJobRunner, enqueueJob, type JobHandlers } from '../../domain/index.js';
import { getBackgroundJobRunners, useDurableJobQueue } from '../background.js';
import {
  GitHubReverseSyncService,
  reverseSyncJobKey,
  type ReverseSyncGitHubClient,
} from './reverse-sync.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

interface FakeIssue {
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
}

type Call =
  | { op: 'update'; updates: { title?: string; body?: string; state?: 'open' | 'closed' } }
  | { op: 'labels'; labels: string[] };

describeDb('GitHub reverse sync (database)', () => {
  let db: Database;
  let service: GitHubReverseSyncService;
  let workspaceId: string;
  let projectId: string;
  let progressStateId: string;
  let doneStateId: string;
  let labelId: string;
  let taskId: string;
  const suffix = crypto.randomUUID().slice(0, 8);
  const owner = `rev-${suffix}`;
  const issue: FakeIssue = { title: 'Initial', body: '', state: 'open', labels: [] };
  const calls: Call[] = [];
  const enqueues: Promise<void>[] = [];

  const fakeClient: ReverseSyncGitHubClient = {
    getIssue: async () => ({ ...issue, labels: [...issue.labels] }),
    updateIssue: async (_number, updates) => {
      calls.push({ op: 'update', updates });
      Object.assign(issue, updates);
      return {};
    },
    setIssueLabels: async (_number, names) => {
      calls.push({ op: 'labels', labels: names });
      issue.labels = names;
      return {};
    },
    addIssueComment: async () => ({ id: 1 }),
  };

  function handlers(): JobHandlers {
    const result: JobHandlers = {};
    for (const [type, run] of getBackgroundJobRunners()) {
      result[type] = async (job) => run(job.payload);
    }
    return result;
  }

  /** Let fire-and-forget enqueues land, then run every due reverse-sync job. */
  async function runJobs(): Promise<void> {
    await Promise.all(enqueues.splice(0));
    const runner = createJobRunner(db, handlers());
    while ((await runner.runOnce()) > 0) {
      // keep going until nothing is due
    }
  }

  async function pendingJobs() {
    return db
      .select({ id: jobs.id, payload: jobs.payload })
      .from(jobs)
      .where(
        and(eq(jobs.key, reverseSyncJobKey(taskId)), isNull(jobs.doneAt), isNull(jobs.failedAt))
      );
  }

  beforeAll(async () => {
    db = createDatabase(TEST_DATABASE_URL);
    useDurableJobQueue({
      enqueue: (type, payload, options) => {
        const pending = enqueueJob(db, type, payload, options).then(() => undefined);
        enqueues.push(pending);
        return pending;
      },
    });
    service = new GitHubReverseSyncService(db, { createClient: async () => fakeClient });

    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Reverse sync', slug: `reverse-sync-${suffix}` })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');
    workspaceId = workspace.id;
    const [project] = await db
      .insert(projects)
      .values({ workspaceId, name: 'Core', identifier: `R${suffix.slice(0, 4).toUpperCase()}` })
      .returning();
    if (!project) throw new Error('project insert failed');
    projectId = project.id;
    const states = await db
      .insert(taskStates)
      .values([
        { projectId, name: 'In Progress', category: 'in_progress', position: 'a0' },
        { projectId, name: 'Done', category: 'done', position: 'a1' },
      ])
      .returning();
    progressStateId = states.find((s) => s.name === 'In Progress')?.id ?? '';
    doneStateId = states.find((s) => s.name === 'Done')?.id ?? '';
    const [label] = await db.insert(labels).values({ projectId, name: 'bug' }).returning();
    labelId = label?.id ?? '';

    const [integration] = await db
      .insert(projectIntegrations)
      .values({
        projectId,
        integrationType: 'github',
        config: { repositories: [{ owner, repo: 'api', installationId: 7 }] },
      })
      .returning();
    const [task] = await db
      .insert(tasks)
      .values({
        projectId,
        stateId: progressStateId,
        sequenceNumber: 1,
        title: 'Initial',
        position: 'a0',
      })
      .returning();
    if (!integration || !task) throw new Error('fixture insert failed');
    taskId = task.id;
    await db.insert(externalLinks).values({
      integrationId: integration.id,
      taskId,
      externalType: 'github_issue',
      externalId: formatGitHubExternalId(owner, 'api', 1),
      externalUrl: `https://github.com/${owner}/api/issues/1`,
    });
  });

  beforeEach(() => {
    calls.length = 0;
  });

  afterAll(async () => {
    useDurableJobQueue(null);
    if (taskId) await db.delete(jobs).where(eq(jobs.key, reverseSyncJobKey(taskId)));
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.$client.end({ timeout: 2 });
  });

  test('Done then back to In Progress: one coalesced job pushes the current state', async () => {
    await db.update(tasks).set({ stateId: doneStateId }).where(eq(tasks.id, taskId));
    service.scheduleTaskSync(taskId, { state: true });
    await db
      .update(tasks)
      .set({ stateId: progressStateId, title: 'Renamed' })
      .where(eq(tasks.id, taskId));
    service.scheduleTaskSync(taskId, { state: true, title: true });
    await Promise.all(enqueues);

    const pending = await pendingJobs();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.payload).toMatchObject({ taskId, state: true, title: true });

    await runJobs();
    expect(calls).toEqual([{ op: 'update', updates: { title: 'Renamed', state: 'open' } }]);
    expect(issue.state).toBe('open');
  });

  test('skips the push when GitHub already has the content (sync hash)', async () => {
    service.scheduleTaskSync(taskId, { title: true, state: true });
    await runJobs();
    expect(calls).toEqual([]);
  });

  test('labels are read at run time', async () => {
    service.scheduleTaskSync(taskId, { labels: true });
    await db.insert(taskLabels).values({ taskId, labelId });
    await runJobs();
    expect(calls).toEqual([{ op: 'labels', labels: ['bug'] }]);
  });

  test('delete closes and restore reopens, decided when the job runs', async () => {
    await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, taskId));
    service.scheduleIssueStateSync(taskId);
    await runJobs();
    expect(calls).toEqual([{ op: 'update', updates: { state: 'closed' } }]);

    calls.length = 0;
    // Deleted, then restored before the close job ran: the issue stays open.
    service.scheduleIssueStateSync(taskId);
    await db.update(tasks).set({ deletedAt: null }).where(eq(tasks.id, taskId));
    service.scheduleIssueStateSync(taskId);
    await runJobs();
    expect(calls).toEqual([{ op: 'update', updates: { state: 'open' } }]);
  });
});
