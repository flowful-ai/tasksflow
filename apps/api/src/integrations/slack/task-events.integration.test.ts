/**
 * Slack enqueue gate: projects without an enabled Slack integration are
 * cached per project and cleared when an integration is saved or deleted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { projectIntegrations, tasks } from '../../db/index.js';
import {
  TEST_DATABASE_URL,
  createProject,
  createWorkspace,
  testDb,
} from '../../domain/task/test-fixtures.js';
import {
  applyRemoteInvalidation,
  setCacheInvalidationBroadcaster,
} from '../../lib/cache-invalidation.js';
import { NonRetryableError } from '../background.js';
import { SlackClient } from './client.js';
import {
  SLACK_PROJECT_CACHE_TTL_MS,
  clearSlackProjectCache,
  deliverSlackTaskEvent,
  slackEnabledForProject,
} from './task-events.js';
import { SlackWebApi, type FetchLike } from './web-api.js';

describe.skipIf(!TEST_DATABASE_URL)('slackEnabledForProject (integration)', () => {
  it('caches the answer per project until the TTL or an explicit clear', async () => {
    const db = testDb();
    const ws = await createWorkspace(db);
    const project = await createProject(db, ws.workspaceId);
    const now = Date.now();

    expect(await slackEnabledForProject(project.projectId, db, now)).toBe(false);
    await db.insert(projectIntegrations).values({
      projectId: project.projectId,
      integrationType: 'slack',
      config: {},
      isEnabled: true,
    });
    // Still cached, until it expires or is cleared.
    expect(await slackEnabledForProject(project.projectId, db, now + 1)).toBe(false);
    expect(
      await slackEnabledForProject(project.projectId, db, now + SLACK_PROJECT_CACHE_TTL_MS + 1)
    ).toBe(true);

    await db
      .delete(projectIntegrations)
      .where(eq(projectIntegrations.projectId, project.projectId));
    clearSlackProjectCache(project.projectId);
    expect(await slackEnabledForProject(project.projectId, db)).toBe(false);
  });

  it('broadcasts a clear to other instances and applies theirs', async () => {
    const db = testDb();
    const ws = await createWorkspace(db);
    const project = await createProject(db, ws.workspaceId);
    const sent: [string, string | null][] = [];
    const previous = setCacheInvalidationBroadcaster((cache, key) => sent.push([cache, key]));
    try {
      expect(await slackEnabledForProject(project.projectId, db)).toBe(false);
      await db.insert(projectIntegrations).values({
        projectId: project.projectId,
        integrationType: 'slack',
        config: {},
        isEnabled: true,
      });
      expect(await slackEnabledForProject(project.projectId, db)).toBe(false);

      // Another instance saved the integration: its broadcast clears our entry.
      applyRemoteInvalidation('slack.project_enabled', project.projectId);
      expect(await slackEnabledForProject(project.projectId, db)).toBe(true);

      clearSlackProjectCache(project.projectId);
      expect(sent).toEqual([['slack.project_enabled', project.projectId]]);
    } finally {
      setCacheInvalidationBroadcaster(previous);
    }
  });
});

describe.skipIf(!TEST_DATABASE_URL)('deliverSlackTaskEvent (integration)', () => {
  async function slackProjectTask(): Promise<string> {
    const db = testDb();
    const ws = await createWorkspace(db);
    const project = await createProject(db, ws.workspaceId);
    await db.insert(projectIntegrations).values({
      projectId: project.projectId,
      integrationType: 'slack',
      config: { teamId: 'T1', channelId: 'C1', channelName: 'eng', notifications: {} },
      isEnabled: true,
    });
    const [task] = await db
      .insert(tasks)
      .values({
        projectId: project.projectId,
        stateId: project.states.backlog,
        sequenceNumber: 1,
        title: 'Ship it',
        position: 'a0',
      })
      .returning();
    if (!task) throw new Error('fixture insert failed');
    return task.id;
  }

  function clientAnswering(status: number, body: object): (token: string) => SlackClient {
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '600' },
      });
    return (token) => new SlackClient(new SlackWebApi({ token, fetchImpl }));
  }

  const previousToken = process.env.SLACK_BOT_TOKEN;
  beforeAll(() => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-env-token';
  });
  afterAll(() => {
    if (previousToken === undefined) delete process.env.SLACK_BOT_TOKEN;
    else process.env.SLACK_BOT_TOKEN = previousToken;
  });

  it('sends the notification when Slack answers ok', async () => {
    const taskId = await slackProjectTask();
    const outcome = await deliverSlackTaskEvent(
      testDb(),
      { type: 'task.created', taskId },
      { createClient: clientAnswering(200, { ok: true, ts: '1.1' }) }
    );
    expect(outcome).toBe('sent');
  });

  it('turns a Slack platform error into a NonRetryableError', async () => {
    const taskId = await slackProjectTask();
    const error = await deliverSlackTaskEvent(
      testDb(),
      { type: 'task.created', taskId },
      { createClient: clientAnswering(200, { ok: false, error: 'channel_not_found' }) }
    ).catch((e: Error) => e);
    expect(error).toBeInstanceOf(NonRetryableError);
    expect(error).toMatchObject({ message: 'Slack chat.postMessage failed: channel_not_found' });
  });

  it('leaves a rate limit retryable', async () => {
    const taskId = await slackProjectTask();
    const error = await deliverSlackTaskEvent(
      testDb(),
      { type: 'task.created', taskId },
      { createClient: clientAnswering(429, { ok: false, error: 'ratelimited' }) }
    ).catch((e: Error) => e);
    expect(error).not.toBeInstanceOf(NonRetryableError);
    expect(error).toMatchObject({ status: 429 });
  });
});
