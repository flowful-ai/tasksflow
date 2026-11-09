import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { labels, taskStates, tasks, workspaceMembers, workspaces } from '../db/index.js';
import { integrationEnabled, setupHarness, type Harness, type Seed } from './harness.js';

/**
 * Cross-tenant isolation, project ACL and role matrix for every endpoint of
 * the workspace, project, task, comment, smart-view and app-admin routers.
 */

interface EndpointCase {
  name: string;
  method: string;
  path: string;
  body?: object;
}

const DENIED = [403, 404];

/** Every endpoint touching a workspace-A resource, called with B-side or A-side ids. */
function workspaceAEndpoints(s: Seed, foreignUserId: string): EndpointCase[] {
  const ws = s.workspaceA.id;
  const p = s.projectA;
  const t = s.taskA;
  const v = s.teamViewA;
  return [
    // workspaces
    { name: 'get workspace', method: 'GET', path: `/api/workspaces/${ws}` },
    { name: 'get my role', method: 'GET', path: `/api/workspaces/${ws}/me` },
    { name: 'get by slug', method: 'GET', path: `/api/workspaces/by-slug/${s.workspaceA.slug}` },
    { name: 'activity', method: 'GET', path: `/api/workspaces/${ws}/activity` },
    { name: 'update workspace', method: 'PATCH', path: `/api/workspaces/${ws}`, body: { name: 'pwned' } },
    { name: 'delete workspace', method: 'DELETE', path: `/api/workspaces/${ws}` },
    { name: 'list members', method: 'GET', path: `/api/workspaces/${ws}/members` },
    { name: 'add member', method: 'POST', path: `/api/workspaces/${ws}/members`, body: { userId: foreignUserId, role: 'owner' } },
    { name: 'change member role', method: 'PATCH', path: `/api/workspaces/${ws}/members/${s.users.memberA.id}`, body: { role: 'admin' } },
    { name: 'remove member', method: 'DELETE', path: `/api/workspaces/${ws}/members/${s.users.memberA.id}` },
    { name: 'transfer ownership', method: 'POST', path: `/api/workspaces/${ws}/transfer-ownership`, body: { userId: foreignUserId } },
    // projects
    { name: 'list projects', method: 'GET', path: `/api/projects?workspaceId=${ws}` },
    { name: 'create project', method: 'POST', path: '/api/projects', body: { workspaceId: ws, name: 'X', identifier: 'XX' } },
    { name: 'get project', method: 'GET', path: `/api/projects/${p.id}` },
    { name: 'project permissions', method: 'GET', path: `/api/projects/${p.id}/permissions` },
    { name: 'update project', method: 'PATCH', path: `/api/projects/${p.id}`, body: { name: 'pwned' } },
    { name: 'delete project', method: 'DELETE', path: `/api/projects/${p.id}` },
    { name: 'list states', method: 'GET', path: `/api/projects/${p.id}/states` },
    { name: 'create state', method: 'POST', path: `/api/projects/${p.id}/states`, body: { name: 'X', category: 'backlog' } },
    { name: 'update state', method: 'PATCH', path: `/api/projects/${p.id}/states/${p.stateId}`, body: { name: 'pwned' } },
    { name: 'delete state', method: 'DELETE', path: `/api/projects/${p.id}/states/${p.stateId}` },
    { name: 'create label', method: 'POST', path: `/api/projects/${p.id}/labels`, body: { name: 'X' } },
    { name: 'update label', method: 'PATCH', path: `/api/projects/${p.id}/labels/${p.labelId}`, body: { name: 'pwned' } },
    { name: 'delete label', method: 'DELETE', path: `/api/projects/${p.id}/labels/${p.labelId}` },
    { name: 'project members', method: 'GET', path: `/api/projects/${p.id}/members` },
    { name: 'set project access', method: 'PUT', path: `/api/projects/${p.id}/members`, body: { access: 'members', userIds: [] } },
    // tasks
    { name: 'list tasks', method: 'GET', path: `/api/tasks?projectId=${p.id}` },
    { name: 'create task', method: 'POST', path: '/api/tasks', body: { projectId: p.id, title: 'pwned' } },
    { name: 'get task', method: 'GET', path: `/api/tasks/${t}` },
    { name: 'update task', method: 'PATCH', path: `/api/tasks/${t}`, body: { title: 'pwned' } },
    { name: 'move task', method: 'POST', path: `/api/tasks/${t}/move`, body: { stateId: p.otherStateId, position: 'a5' } },
    { name: 'delete task', method: 'DELETE', path: `/api/tasks/${t}` },
    { name: 'restore task', method: 'POST', path: `/api/tasks/${t}/restore` },
    { name: 'add assignee', method: 'POST', path: `/api/tasks/${t}/assignees`, body: { userId: foreignUserId } },
    { name: 'remove assignee', method: 'DELETE', path: `/api/tasks/${t}/assignees/${s.users.memberA.id}` },
    { name: 'add label', method: 'POST', path: `/api/tasks/${t}/labels`, body: { labelId: p.labelId } },
    { name: 'remove label', method: 'DELETE', path: `/api/tasks/${t}/labels/${p.labelId}` },
    { name: 'github issue', method: 'POST', path: `/api/tasks/${t}/github-issue`, body: { owner: 'o', repo: 'r' } },
    { name: 'github pr', method: 'POST', path: `/api/tasks/${t}/github-pr`, body: { owner: 'o', repo: 'r', prNumber: 1 } },
    // comments
    { name: 'list comments', method: 'GET', path: `/api/tasks/${t}/comments` },
    { name: 'comment count', method: 'GET', path: `/api/tasks/${t}/comments/count` },
    { name: 'create comment', method: 'POST', path: `/api/tasks/${t}/comments`, body: { content: 'pwned' } },
    { name: 'get comment', method: 'GET', path: `/api/tasks/${t}/comments/${s.commentA}` },
    { name: 'update comment', method: 'PATCH', path: `/api/tasks/${t}/comments/${s.commentA}`, body: { content: 'pwned' } },
    { name: 'delete comment', method: 'DELETE', path: `/api/tasks/${t}/comments/${s.commentA}` },
    // smart views
    { name: 'list views', method: 'GET', path: `/api/smart-views?workspaceId=${ws}` },
    { name: 'create view', method: 'POST', path: '/api/smart-views', body: { workspaceId: ws, name: 'pwned' } },
    { name: 'get view', method: 'GET', path: `/api/smart-views/${v}` },
    { name: 'execute view', method: 'GET', path: `/api/smart-views/${v}/execute` },
    { name: 'update view', method: 'PATCH', path: `/api/smart-views/${v}`, body: { name: 'pwned' } },
    { name: 'delete view', method: 'DELETE', path: `/api/smart-views/${v}` },
    { name: 'share view', method: 'POST', path: `/api/smart-views/${v}/shares`, body: { userId: foreignUserId } },
    { name: 'unshare view', method: 'DELETE', path: `/api/smart-views/${v}/shares/${s.users.memberA.id}` },
    { name: 'create public share', method: 'POST', path: `/api/smart-views/${v}/public`, body: {} },
    { name: 'disable public share', method: 'POST', path: `/api/smart-views/${v}/public/${s.publicShareA.id}/disable` },
    { name: 'delete public share', method: 'DELETE', path: `/api/smart-views/${v}/public/${s.publicShareA.id}` },
    // realtime
    { name: 'event stream', method: 'GET', path: `/api/events/stream?workspaceId=${ws}` },
  ];
}

async function expectAUnchanged(h: Harness): Promise<void> {
  const s = h.seed;
  const [ws] = await h.db.select().from(workspaces).where(eq(workspaces.id, s.workspaceA.id));
  expect(ws?.name).toBe('Workspace A');
  const members = await h.db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, s.workspaceA.id));
  expect(members.length).toBe(4);
  expect(members.find((m) => m.userId === s.users.ownerA.id)?.role).toBe('owner');
  const [state] = await h.db.select().from(taskStates).where(eq(taskStates.id, s.projectA.stateId));
  expect(state?.name).not.toBe('pwned');
  const [label] = await h.db.select().from(labels).where(eq(labels.id, s.projectA.labelId));
  expect(label?.name).not.toBe('pwned');
  const [task] = await h.db.select().from(tasks).where(eq(tasks.id, s.taskA));
  expect(task?.title).toBe('Open task A');
  expect(task?.deletedAt).toBeNull();
}

describe.skipIf(!integrationEnabled)('cross-workspace isolation', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  it('authenticates with a real session cookie and rejects anonymous calls', async () => {
    const me = await h.request('ownerA', 'GET', `/api/workspaces/${h.seed.workspaceA.id}/me`);
    expect(me.status).toBe(200);
    expect(me.body.data).toEqual({ role: 'owner' });
    expect((await h.request(null, 'GET', `/api/workspaces/${h.seed.workspaceA.id}/me`)).status).toBe(401);
  });

  it('denies a workspace-B owner on every workspace-A endpoint and changes nothing', async () => {
    const failures: string[] = [];
    for (const endpoint of workspaceAEndpoints(h.seed, h.seed.users.ownerB.id)) {
      const res = await h.request('ownerB', endpoint.method, endpoint.path, endpoint.body);
      if (!DENIED.includes(res.status)) failures.push(`${endpoint.name}: ${res.status} ${res.text.slice(0, 120)}`);
    }
    expect(failures).toEqual([]);
    await expectAUnchanged(h);
  });

  it('denies a workspace-B member on every workspace-A endpoint', async () => {
    const failures: string[] = [];
    for (const endpoint of workspaceAEndpoints(h.seed, h.seed.users.memberB.id)) {
      const res = await h.request('memberB', endpoint.method, endpoint.path, endpoint.body);
      if (!DENIED.includes(res.status)) failures.push(`${endpoint.name}: ${res.status}`);
    }
    expect(failures).toEqual([]);
    await expectAUnchanged(h);
  });

  it('does not list workspace A to workspace-B users', async () => {
    const res = await h.request('ownerB', 'GET', '/api/workspaces');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(h.seed.workspaceA.id);
  });

  it('cannot edit or delete another project\'s task states or labels through an own project', async () => {
    const own = h.seed.projectB.id;
    const foreign = h.seed.projectA;
    const attempts = [
      await h.request('ownerB', 'PATCH', `/api/projects/${own}/states/${foreign.stateId}`, { name: 'pwned' }),
      await h.request('ownerB', 'DELETE', `/api/projects/${own}/states/${foreign.stateId}`),
      await h.request('ownerB', 'PATCH', `/api/projects/${own}/labels/${foreign.labelId}`, { name: 'pwned' }),
      await h.request('ownerB', 'DELETE', `/api/projects/${own}/labels/${foreign.labelId}`),
    ];
    expect(attempts.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    const [state] = await h.db.select().from(taskStates).where(eq(taskStates.id, foreign.stateId));
    const [label] = await h.db.select().from(labels).where(eq(labels.id, foreign.labelId));
    expect(state?.name).not.toBe('pwned');
    expect(label).toBeDefined();
    expect(label?.name).not.toBe('pwned');
  });

  it('rejects foreign states, labels and assignees on own tasks', async () => {
    const own = h.seed.taskB;
    const foreign = h.seed.projectA;
    const results = [
      await h.request('ownerB', 'POST', `/api/tasks/${own}/move`, { stateId: foreign.stateId, position: 'a1' }),
      await h.request('ownerB', 'PATCH', `/api/tasks/${own}`, { stateId: foreign.stateId }),
      await h.request('ownerB', 'POST', `/api/tasks/${own}/labels`, { labelId: foreign.labelId }),
      await h.request('ownerB', 'POST', `/api/tasks/${own}/assignees`, { userId: h.seed.users.memberA.id }),
      await h.request('ownerB', 'POST', '/api/tasks', {
        projectId: h.seed.projectB.id,
        title: 'x',
        assigneeIds: [h.seed.users.ownerA.id],
      }),
    ];
    expect(results.map((r) => r.status)).toEqual([400, 400, 400, 400, 400]);
    expect(results.map((r) => r.text).join('')).not.toContain(h.seed.users.memberA.email);
  });

  it('returns 404, not 500, for malformed ids', async () => {
    for (const path of ['/api/tasks/FLOW-123', '/api/projects/not-a-uuid', '/api/smart-views/nope', '/api/tasks/FLOW-1/comments']) {
      expect((await h.request('ownerA', 'GET', path)).status).toBe(404);
    }
  });
});

describe.skipIf(!integrationEnabled)('project ACL', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  it('hides restricted and admin-only projects from members without access', async () => {
    const s = h.seed;
    const failures: string[] = [];
    for (const project of [s.restrictedA, s.adminOnlyA]) {
      const task = project === s.restrictedA ? s.restrictedTaskA : s.adminOnlyTaskA;
      const cases: EndpointCase[] = [
        { name: 'get project', method: 'GET', path: `/api/projects/${project.id}` },
        { name: 'states', method: 'GET', path: `/api/projects/${project.id}/states` },
        { name: 'tasks', method: 'GET', path: `/api/tasks?projectId=${project.id}` },
        { name: 'create task', method: 'POST', path: '/api/tasks', body: { projectId: project.id, title: 'x' } },
        { name: 'get task', method: 'GET', path: `/api/tasks/${task}` },
        { name: 'update task', method: 'PATCH', path: `/api/tasks/${task}`, body: { title: 'x' } },
        { name: 'comments', method: 'GET', path: `/api/tasks/${task}/comments` },
        { name: 'comment count', method: 'GET', path: `/api/tasks/${task}/comments/count` },
        { name: 'create comment', method: 'POST', path: `/api/tasks/${task}/comments`, body: { content: 'x' } },
        { name: 'get comment', method: 'GET', path: `/api/tasks/${task}/comments/${s.restrictedCommentA}` },
      ];
      for (const endpoint of cases) {
        const res = await h.request('memberA', endpoint.method, endpoint.path, endpoint.body);
        if (res.status !== 404) failures.push(`${project.id === s.restrictedA.id ? 'restricted' : 'admin-only'} ${endpoint.name}: ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('lets project members and admins in', async () => {
    const s = h.seed;
    expect((await h.request('insiderA', 'GET', `/api/projects/${s.restrictedA.id}`)).status).toBe(200);
    expect((await h.request('insiderA', 'GET', `/api/tasks/${s.restrictedTaskA}/comments`)).status).toBe(200);
    expect((await h.request('adminA', 'GET', `/api/tasks/${s.adminOnlyTaskA}`)).status).toBe(200);
    expect((await h.request('insiderA', 'GET', `/api/tasks/${s.adminOnlyTaskA}`)).status).toBe(404);
  });

  it('filters project lists, smart-view execution and the activity feed', async () => {
    const s = h.seed;
    const projects = await h.request('memberA', 'GET', `/api/projects?workspaceId=${s.workspaceA.id}`);
    expect(projects.text).toContain(s.projectA.id);
    expect(projects.text).not.toContain(s.restrictedA.id);
    expect(projects.text).not.toContain(s.adminOnlyA.id);

    const executed = await h.request('memberA', 'GET', `/api/smart-views/${s.teamViewA}/execute`);
    expect(executed.status).toBe(200);
    expect(executed.text).toContain(s.taskA);
    expect(executed.text).not.toContain(s.restrictedTaskA);
    expect(executed.text).not.toContain(s.adminOnlyTaskA);
    expect(executed.text).not.toContain('Secret task A');

    const insiderView = await h.request('insiderA', 'GET', `/api/smart-views/${s.teamViewA}/execute`);
    expect(insiderView.text).toContain(s.restrictedTaskA);
    expect(insiderView.text).not.toContain(s.adminOnlyTaskA);

    const activity = await h.request('memberA', 'GET', `/api/workspaces/${s.workspaceA.id}/activity?limit=100`);
    expect(activity.status).toBe(200);
    expect(activity.text).toContain(s.taskA);
    expect(activity.text).not.toContain(s.restrictedTaskA);
    expect(activity.text).not.toContain(s.adminOnlyTaskA);

    const ownerActivity = await h.request('ownerA', 'GET', `/api/workspaces/${s.workspaceA.id}/activity?limit=100`);
    expect(ownerActivity.text).toContain(s.restrictedTaskA);
  });

  it('caps smart-view execution at 100 tasks per page', async () => {
    const res = await h.request('ownerA', 'GET', `/api/smart-views/${h.seed.teamViewA}/execute?limit=100000&page=abc`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.data)).toContain('"limit":100');
    expect(JSON.stringify(res.body.data)).toContain('"page":1');
  });

  it('keeps personal smart views private to their creator', async () => {
    const s = h.seed;
    expect((await h.request('adminA', 'GET', `/api/smart-views/${s.personalViewA}`)).status).toBe(200);
    for (const user of ['ownerA', 'memberA'] as const) {
      expect((await h.request(user, 'GET', `/api/smart-views/${s.personalViewA}`)).status).toBe(404);
      expect((await h.request(user, 'GET', `/api/smart-views/${s.personalViewA}/execute`)).status).toBe(404);
      expect((await h.request(user, 'DELETE', `/api/smart-views/${s.personalViewA}`)).status).toBe(404);
    }
    const list = await h.request('ownerA', 'GET', `/api/smart-views?workspaceId=${s.workspaceA.id}`);
    expect(list.text).not.toContain(s.personalViewA);
  });

  it('never returns share password hashes', async () => {
    const s = h.seed;
    const created = await h.request('adminA', 'POST', `/api/smart-views/${s.teamViewA}/public`, { password: 'hunter22' });
    expect(created.status).toBe(201);
    expect(created.text).not.toContain('$2');
    const view = await h.request('adminA', 'GET', `/api/smart-views/${s.teamViewA}`);
    expect(view.text).not.toContain('$2');
    expect(view.text).toContain('"hasPassword":true');
  });

  it('serves the comment count (not shadowed by /:commentId)', async () => {
    const res = await h.request('memberA', 'GET', `/api/tasks/${h.seed.taskA}/comments/count`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ count: 1 });
  });

  it('clamps comment pagination', async () => {
    const res = await h.request('memberA', 'GET', `/api/tasks/${h.seed.taskA}/comments?limit=9999&page=NaN`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.text)).toContain('\\"limit\\":100');
  });
});

describe.skipIf(!integrationEnabled)('role matrix', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setupHarness();
  }, 120_000);

  async function roleOf(userId: string): Promise<string | undefined> {
    const [row] = await h.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, h.seed.workspaceA.id), eq(workspaceMembers.userId, userId)));
    return row?.role;
  }

  it('admin cannot promote themselves to owner', async () => {
    const s = h.seed;
    const res = await h.request('adminA', 'PATCH', `/api/workspaces/${s.workspaceA.id}/members/${s.users.adminA.id}`, {
      role: 'owner',
    });
    expect(res.status).toBe(403);
    expect(await roleOf(s.users.adminA.id)).toBe('admin');
  });

  it('admin cannot demote or remove the owner, nor delete the workspace', async () => {
    const s = h.seed;
    const ws = s.workspaceA.id;
    expect((await h.request('adminA', 'PATCH', `/api/workspaces/${ws}/members/${s.users.ownerA.id}`, { role: 'member' })).status).toBe(403);
    expect((await h.request('adminA', 'DELETE', `/api/workspaces/${ws}/members/${s.users.ownerA.id}`)).status).toBe(403);
    expect((await h.request('adminA', 'DELETE', `/api/workspaces/${ws}`)).status).toBe(403);
    expect(await roleOf(s.users.ownerA.id)).toBe('owner');
  });

  it('admin cannot grant owner when adding or promoting members', async () => {
    const s = h.seed;
    const ws = s.workspaceA.id;
    expect((await h.request('adminA', 'POST', `/api/workspaces/${ws}/members`, { userId: s.users.memberB.id, role: 'owner' })).status).toBe(403);
    expect((await h.request('adminA', 'PATCH', `/api/workspaces/${ws}/members/${s.users.memberA.id}`, { role: 'owner' })).status).toBe(403);
    expect(await roleOf(s.users.memberB.id)).toBeUndefined();
    expect(await roleOf(s.users.memberA.id)).toBe('member');
  });

  it('admin can manage roles at or below admin', async () => {
    const s = h.seed;
    const ws = s.workspaceA.id;
    expect((await h.request('adminA', 'PATCH', `/api/workspaces/${ws}/members/${s.users.memberA.id}`, { role: 'admin' })).status).toBe(200);
    expect((await h.request('adminA', 'POST', `/api/workspaces/${ws}/members`, { userId: s.users.memberB.id, role: 'member' })).status).toBe(201);
    expect(await roleOf(s.users.memberA.id)).toBe('admin');
  });

  it('only an owner can transfer ownership', async () => {
    const s = h.seed;
    const ws = s.workspaceA.id;
    expect((await h.request('adminA', 'POST', `/api/workspaces/${ws}/transfer-ownership`, { userId: s.users.adminA.id })).status).toBe(403);
    expect((await h.request('ownerA', 'POST', `/api/workspaces/${ws}/transfer-ownership`, { userId: s.users.memberB.id })).status).toBe(404);

    const res = await h.request('ownerA', 'POST', `/api/workspaces/${ws}/transfer-ownership`, { userId: s.users.adminA.id });
    expect(res.status).toBe(200);
    expect(await roleOf(s.users.adminA.id)).toBe('owner');
    expect(await roleOf(s.users.ownerA.id)).toBe('admin');
  });

  it('the last owner cannot be demoted or leave', async () => {
    const s = h.seed;
    const ws = s.workspaceA.id;
    expect((await h.request('ownerA', 'PATCH', `/api/workspaces/${ws}/members/${s.users.ownerA.id}`, { role: 'admin' })).status).toBe(409);
    expect((await h.request('ownerA', 'DELETE', `/api/workspaces/${ws}/members/${s.users.ownerA.id}`)).status).toBe(409);
  });

  it('members are limited to their role permissions', async () => {
    const s = h.seed;
    const ws = s.workspaceA.id;
    const cases: EndpointCase[] = [
      { name: 'update workspace', method: 'PATCH', path: `/api/workspaces/${ws}`, body: { name: 'x' } },
      { name: 'add member', method: 'POST', path: `/api/workspaces/${ws}/members`, body: { userId: s.users.memberB.id } },
      { name: 'change role', method: 'PATCH', path: `/api/workspaces/${ws}/members/${s.users.insiderA.id}`, body: { role: 'member' } },
      { name: 'remove member', method: 'DELETE', path: `/api/workspaces/${ws}/members/${s.users.insiderA.id}` },
      { name: 'create project', method: 'POST', path: '/api/projects', body: { workspaceId: ws, name: 'X', identifier: 'XY' } },
      { name: 'update project', method: 'PATCH', path: `/api/projects/${s.projectA.id}`, body: { name: 'x' } },
      { name: 'delete project', method: 'DELETE', path: `/api/projects/${s.projectA.id}` },
      { name: 'update state', method: 'PATCH', path: `/api/projects/${s.projectA.id}/states/${s.projectA.stateId}`, body: { name: 'x' } },
      { name: 'set access', method: 'PUT', path: `/api/projects/${s.projectA.id}/members`, body: { access: 'admin' } },
      { name: 'delete task', method: 'DELETE', path: `/api/tasks/${s.taskA}` },
      { name: 'assign other', method: 'POST', path: `/api/tasks/${s.taskA}/assignees`, body: { userId: s.users.insiderA.id } },
      { name: 'update team view', method: 'PATCH', path: `/api/smart-views/${s.teamViewA}`, body: { name: 'x' } },
      { name: 'delete team view', method: 'DELETE', path: `/api/smart-views/${s.teamViewA}` },
      { name: 'public share', method: 'POST', path: `/api/smart-views/${s.teamViewA}/public`, body: {} },
      { name: 'edit others comment', method: 'PATCH', path: `/api/tasks/${s.restrictedTaskA}/comments/${s.restrictedCommentA}`, body: { content: 'x' } },
    ];
    const failures: string[] = [];
    for (const endpoint of cases) {
      const res = await h.request('memberA', endpoint.method, endpoint.path, endpoint.body);
      if (!DENIED.includes(res.status)) failures.push(`${endpoint.name}: ${res.status}`);
    }
    expect(failures).toEqual([]);

    // ...but can do member things.
    expect((await h.request('memberA', 'POST', '/api/tasks', { projectId: s.projectA.id, title: 'mine' })).status).toBe(201);
    expect((await h.request('memberA', 'POST', `/api/tasks/${s.taskA}/comments`, { content: 'hi' })).status).toBe(201);
    expect((await h.request('memberA', 'DELETE', `/api/workspaces/${ws}/members/${s.users.memberA.id}`)).status).toBe(200);
  });

  it('admins can moderate comments, authors keep control of their own', async () => {
    const s = h.seed;
    expect((await h.request('insiderA', 'PATCH', `/api/tasks/${s.taskA}/comments/${s.commentA}`, { content: 'x' })).status).toBe(403);
    expect((await h.request('memberA', 'PATCH', `/api/tasks/${s.taskA}/comments/${s.commentA}`, { content: 'edited' })).status).toBe(200);
    expect((await h.request('adminA', 'DELETE', `/api/tasks/${s.taskA}/comments/${s.commentA}`)).status).toBe(200);
  });
});
