import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { WorkspaceRole } from '@flowtask/shared';
import { integrationEnabled, setupHarness, TEST_DATABASE_URL, type Harness } from './harness.js';
import { RealtimeHub, type AccessResolver, type ClientSink } from '../sse/hub.js';
import { createDatabase, type Database } from '../db/index.js';
import { LISTEN_APPLICATION_NAME, PostgresTransport } from '../sse/postgres-transport.js';

const decoder = new TextDecoder();

function sink(): ClientSink & { text: () => string; closed: boolean } {
  const chunks: string[] = [];
  const s = {
    closed: false,
    text: () => chunks.join(''),
    write(chunk: Uint8Array) {
      if (s.closed) return false;
      chunks.push(decoder.decode(chunk));
      return true;
    },
    close() {
      s.closed = true;
    },
  };
  return s;
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await Bun.sleep(20);
  }
}

/** Collect an SSE response body in the background. */
function collect(res: Response): { text: () => string; done: () => boolean } {
  let text = '';
  let finished = false;
  const reader = res.body?.getReader();
  void (async () => {
    if (!reader) return;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    finished = true;
  })().catch(() => {
    finished = true;
  });
  return { text: () => text, done: () => finished };
}

describe.skipIf(!integrationEnabled)('realtime over Postgres LISTEN/NOTIFY', () => {
  const staticResolver = (role: WorkspaceRole, projects: string[]): AccessResolver => ({
    getRole: async () => role,
    listAccessibleProjectIds: async () => projects,
    activeSessionIds: async (sessionIds) => new Set(sessionIds),
  });

  let a: RealtimeHub;
  let b: RealtimeHub;
  // Stands in for the application pool, which NOTIFY goes through.
  let pool: Database;

  beforeAll(async () => {
    const url = TEST_DATABASE_URL ?? '';
    pool = createDatabase(url);
    const transport = () =>
      new PostgresTransport(url, async (channel, payload) => {
        await pool.$client.notify(channel, payload);
      });
    a = new RealtimeHub({
      resolver: staticResolver('member', ['p-open']),
      transportFactory: transport,
    });
    b = new RealtimeHub({
      resolver: staticResolver('member', ['p-open']),
      transportFactory: transport,
    });
    await a.start();
    await b.start();
  });

  afterAll(async () => {
    await a?.stop();
    await b?.stop();
    await pool?.$client.end({ timeout: 2 });
  });

  it('uses exactly one extra connection per instance: the LISTEN', async () => {
    await a.publishEventAsync(crypto.randomUUID(), 'task:updated', { id: 'warm-up' }, 'workspace');
    const rows = await pool.$client<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE application_name = ${LISTEN_APPLICATION_NAME} AND datname = current_database()`;
    expect(rows[0]?.count).toBe(2);
  });

  it('fans events out across instances with project filtering and no echo', async () => {
    const workspaceId = crypto.randomUUID();
    const onA = sink();
    const onB = sink();
    a.addClient({
      userId: 'u1',
      sessionId: 's1',
      workspaceId,
      role: 'member',
      projectIds: ['p-open'],
      sink: onA,
    });
    b.addClient({
      userId: 'u2',
      sessionId: 's2',
      workspaceId,
      role: 'member',
      projectIds: ['p-open'],
      sink: onB,
    });

    await a.publishEventAsync(
      workspaceId,
      'task:updated',
      {
        id: 'secret-task',
        projectId: 'p-secret',
      },
      { projectId: 'p-secret' }
    );
    await a.publishEventAsync(
      workspaceId,
      'task:updated',
      {
        id: 'open-task',
        projectId: 'p-open',
      },
      { projectId: 'p-open' }
    );
    await waitFor(() => onB.text().includes('open-task'));

    expect(onB.text()).not.toContain('secret-task');
    expect(onA.text().match(/open-task/g)?.length).toBe(1);
  });

  it('sends ids only for payloads over the NOTIFY limit', async () => {
    const workspaceId = crypto.randomUUID();
    const onB = sink();
    b.addClient({
      userId: 'u3',
      sessionId: 's3',
      workspaceId,
      role: 'admin',
      projectIds: [],
      sink: onB,
    });
    await a.publishEventAsync(
      workspaceId,
      'task:updated',
      {
        id: 'big',
        projectId: 'p-open',
        description: 'x'.repeat(20_000),
      },
      { projectId: 'p-open' }
    );
    await waitFor(() => onB.text().includes('"big"'));
    expect(onB.text()).toContain('"truncated":true');
    expect(onB.text()).not.toContain('xxxxxxxx');
  });

  it('closes a removed member on other instances', async () => {
    const workspaceId = crypto.randomUUID();
    const onB = sink();
    b.addClient({
      userId: 'removed',
      sessionId: 's4',
      workspaceId,
      role: 'member',
      projectIds: [],
      sink: onB,
    });
    a.notifyMemberRemoved(workspaceId, 'removed');
    await waitFor(() => onB.closed);
    expect(b.getWorkspaceClientCount(workspaceId)).toBe(0);
  });
});

describe.skipIf(!integrationEnabled)('SSE stream endpoint', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  it('filters by project access and drops removed members immediately', async () => {
    const s = h.seed;
    const res = await h.raw('memberA', 'GET', `/api/events/stream?workspaceId=${s.workspaceA.id}`);
    expect(res.status).toBe(200);
    const stream = collect(res);
    await waitFor(() => stream.text().includes('event: connected'));
    expect(stream.text()).toContain('retry: 5000');

    // An update in the restricted project is not delivered; one in the open project is.
    expect(
      (
        await h.request('insiderA', 'PATCH', `/api/tasks/${s.restrictedTaskA}`, {
          title: 'Secret rename',
        })
      ).status
    ).toBe(200);
    expect(
      (await h.request('ownerA', 'PATCH', `/api/tasks/${s.taskA}`, { title: 'Open rename' })).status
    ).toBe(200);
    await waitFor(() => stream.text().includes('Open rename'));
    expect(stream.text()).not.toContain('Secret rename');
    expect(stream.text()).not.toContain(s.restrictedTaskA);
    expect(stream.text()).toMatch(/id: \S+\nevent: task:updated\n/);

    // Removing the member closes the stream right away.
    expect(
      (
        await h.request(
          'ownerA',
          'DELETE',
          `/api/workspaces/${s.workspaceA.id}/members/${s.users.memberA.id}`
        )
      ).status
    ).toBe(200);
    await waitFor(() => stream.done());
  });

  it('rejects non-members', async () => {
    const res = await h.raw(
      'ownerB',
      'GET',
      `/api/events/stream?workspaceId=${h.seed.workspaceA.id}`
    );
    expect(res.status).toBe(403);
  });
});
