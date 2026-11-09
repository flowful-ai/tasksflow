/**
 * HTTP-level checks for workstream-B routes, mounted in the same order as
 * index.ts (B routes before the tasks/projects routers) with a fake auth
 * middleware. Skipped unless TEST_DATABASE_URL is set.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import type { AuthContext } from '../auth/index.js';
import {
  createDatabase,
  labels,
  projects,
  taskStates,
  users,
  workspaceMembers,
  workspaces,
  type Database,
} from '../db/index.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

interface Fixture {
  workspaceId: string;
  projectId: string;
  otherProjectId: string;
  doneStateId: string;
  owner: { id: string; email: string; name: string | null };
  member: { id: string; email: string; name: string | null };
  outsider: { id: string; email: string; name: string | null };
}

interface ApiBody {
  success: boolean;
  data?: unknown;
  error?: { code: string };
  meta?: { nextCursor?: string | null; total?: number };
}

function rnd(): string {
  return crypto.randomUUID().slice(0, 8);
}

async function createUser(db: Database, name: string) {
  const [user] = await db.insert(users).values({ email: `${rnd()}@routes.test.flowtask.dev`, name }).returning();
  return user!;
}

async function createProject(db: Database, workspaceId: string) {
  const identifier = `R${rnd().replace(/[^0-9a-f]/g, '').slice(0, 5).toUpperCase()}`;
  const [project] = await db.insert(projects).values({ workspaceId, name: `P ${identifier}`, identifier }).returning();
  const states = await db
    .insert(taskStates)
    .values([
      { projectId: project!.id, name: 'Todo', category: 'backlog', position: 'a0' },
      { projectId: project!.id, name: 'Done', category: 'done', position: 'a1' },
    ])
    .returning();
  await db.insert(labels).values({ projectId: project!.id, name: 'bug' });
  return { projectId: project!.id, doneStateId: states[1]!.id };
}

async function createWorkspace(db: Database) {
  const [ws] = await db.insert(workspaces).values({ name: 'Routes', slug: `routes-${rnd()}` }).returning();
  const owner = await createUser(db, 'Owner');
  const member = await createUser(db, 'Member');
  const outsider = await createUser(db, 'Outsider');
  await db.insert(workspaceMembers).values([
    { workspaceId: ws!.id, userId: owner.id, role: 'owner' },
    { workspaceId: ws!.id, userId: member.id, role: 'member' },
  ]);
  return { workspaceId: ws!.id, owner, member, outsider };
}

function isApiBody(value: unknown): value is ApiBody {
  return typeof value === 'object' && value !== null && 'success' in value;
}

describe.skipIf(!TEST_DATABASE_URL)('workstream-B routes (integration)', () => {
  let app: Hono<{ Variables: { auth: AuthContext } }>;
  let fx: Fixture;
  const taskIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const [{ taskBulkRoutes }, { taskRelationRoutes }, { taskHistoryRoutes }, { trashRoutes }, { notificationRoutes }, { searchRoutes }, { taskRoutes }, domain] =
      await Promise.all([
        import('./tasks-bulk.js'),
        import('./task-relations.js'),
        import('./task-history.js'),
        import('./trash.js'),
        import('./notifications.js'),
        import('./search.js'),
        import('./tasks.js'),
        import('../domain/index.js'),
      ]);
    const db = createDatabase(TEST_DATABASE_URL);
    const ws = await createWorkspace(db);
    const project = await createProject(db, ws.workspaceId);
    const otherWs = await createWorkspace(db);
    const other = await createProject(db, otherWs.workspaceId);
    fx = {
      workspaceId: ws.workspaceId,
      projectId: project.projectId,
      otherProjectId: other.projectId,
      doneStateId: project.doneStateId,
      owner: ws.owner,
      member: ws.member,
      outsider: ws.outsider,
    };
    const service = new domain.TaskService(db);
    for (const title of ['alpha routing', 'beta routing']) {
      const created = await service.create({ projectId: project.projectId, title, createdBy: ws.owner.id });
      if (!created.ok) throw created.error;
      taskIds.push(created.value.id);
    }

    app = new Hono<{ Variables: { auth: AuthContext } }>();
    app.use('*', async (c, next) => {
      const userId = c.req.header('x-test-user');
      const user = [fx.owner, fx.member, fx.outsider].find((u) => u.id === userId) ?? null;
      const auth: AuthContext = {
        user: user ? { id: user.id, email: user.email, name: user.name, avatarUrl: null } : null,
        session: null,
      };
      c.set('auth', auth);
      await next();
    });
    app.route('/api/tasks', taskBulkRoutes);
    app.route('/api/tasks', taskRelationRoutes);
    app.route('/api/tasks', taskHistoryRoutes);
    app.route('/api/projects', trashRoutes);
    app.route('/api/notifications', notificationRoutes);
    app.route('/api/search', searchRoutes);
    app.route('/api/tasks', taskRoutes);
  });

  async function call(method: string, path: string, userId: string, body?: object) {
    const res = await app.request(path, {
      method,
      headers: { 'x-test-user': userId, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: unknown = await res.json();
    if (!isApiBody(json)) throw new Error('unexpected body');
    return { status: res.status, body: json };
  }

  it('POST /api/tasks/bulk is not shadowed by /:taskId and checks permissions', async () => {
    const ok = await call('POST', '/api/tasks/bulk', fx.owner.id, {
      taskIds,
      op: { stateId: fx.doneStateId, priority: 'high' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ results: [{ status: 'updated' }, { status: 'updated' }] });

    // Members cannot delete (task:delete is owner/admin only).
    const memberDelete = await call('POST', '/api/tasks/bulk', fx.member.id, { taskIds, op: { delete: true } });
    expect(memberDelete.body.data).toMatchObject({ results: [{ status: 'forbidden' }, { status: 'forbidden' }] });
    const outsider = await call('POST', '/api/tasks/bulk', fx.outsider.id, { taskIds, op: { priority: 'low' } });
    expect(outsider.body.data).toMatchObject({ results: [{ status: 'forbidden' }, { status: 'forbidden' }] });

    const invalid = await call('POST', '/api/tasks/bulk', fx.owner.id, { taskIds: [], op: { priority: 'low' } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('serves relations, history and trash with access checks', async () => {
    const [a, b] = taskIds;
    const added = await call('POST', `/api/tasks/${a}/relations`, fx.owner.id, { relatedTaskId: b, type: 'blocks' });
    expect(added.status).toBe(201);
    const listed = await call('GET', `/api/tasks/${b}/relations`, fx.member.id);
    expect(listed.body.data).toMatchObject([{ type: 'blocks', direction: 'incoming' }]);
    expect((await call('GET', `/api/tasks/${a}/relations`, fx.outsider.id)).status).toBe(404);

    const detail = await call('GET', `/api/tasks/${b}`, fx.owner.id);
    expect(detail.body.data).toMatchObject({ blockedBy: [{ id: a }] });

    const history = await call('GET', `/api/tasks/${a}/history?limit=2`, fx.member.id);
    expect(history.status).toBe(200);
    expect(Array.isArray(history.body.data)).toBe(true);
    expect(history.body.meta?.nextCursor).toBeTruthy();
    expect((await call('GET', `/api/tasks/${a}/history`, fx.outsider.id)).status).toBe(404);

    await call('POST', '/api/tasks/bulk', fx.owner.id, { taskIds: [b], op: { delete: true } });
    const trash = await call('GET', `/api/projects/${fx.projectId}/trash`, fx.member.id);
    expect(trash.body.data).toMatchObject([{ id: b }]);
    expect((await call('GET', `/api/projects/${fx.projectId}/trash`, fx.outsider.id)).status).toBe(404);
    const restored = await call('POST', `/api/projects/${fx.projectId}/trash/${b}/restore`, fx.member.id);
    expect(restored.status).toBe(200);
    expect((await call('POST', `/api/projects/${fx.otherProjectId}/trash/${b}/restore`, fx.owner.id)).status).toBe(404);
  });

  it('searches only accessible projects', async () => {
    const hit = await call('GET', `/api/search?workspaceId=${fx.workspaceId}&q=routing`, fx.member.id);
    expect(hit.status).toBe(200);
    expect(hit.body.data).toMatchObject({ tasks: [{}, {}] });
    expect((await call('GET', `/api/search?workspaceId=${fx.workspaceId}&q=routing`, fx.outsider.id)).status).toBe(403);
    expect((await call('GET', `/api/search?workspaceId=${fx.workspaceId}&q=`, fx.member.id)).status).toBe(400);
  });

  it('serves the inbox endpoints', async () => {
    const count = await call('GET', `/api/notifications/unread-count?workspaceId=${fx.workspaceId}`, fx.member.id);
    expect(count.status).toBe(200);
    expect(count.body.data).toMatchObject({ count: expect.any(Number) });
    const list = await call('GET', `/api/notifications?workspaceId=${fx.workspaceId}&filter=unread`, fx.member.id);
    expect(list.status).toBe(200);
    expect((await call('GET', `/api/notifications?workspaceId=${fx.workspaceId}`, fx.outsider.id)).status).toBe(403);
    const missing = await call('POST', '/api/notifications/00000000-0000-4000-8000-000000000000/read', fx.member.id);
    expect(missing.status).toBe(404);
    const past = await call('POST', '/api/notifications/00000000-0000-4000-8000-000000000000/snooze', fx.member.id, {
      until: '2000-01-01T00:00:00Z',
    });
    expect(past.status).toBe(400);
  });
});
