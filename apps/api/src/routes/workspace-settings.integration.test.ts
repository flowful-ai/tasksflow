/**
 * Settings page endpoints: workspace rename and delete permissions, leaving a
 * workspace (DELETE members/:self), and the Better Auth profile and session
 * endpoints the Profile tab calls. Skipped unless TEST_DATABASE_URL is set.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { sessions, users, workspaceMembers, workspaces } from '../db/index.js';
import { domainEvents } from '../domain/index.js';
import { integrationEnabled, setupHarness, type Harness } from '../test/harness.js';

/** Better Auth checks the Origin of cookie-authenticated POSTs. */
const ORIGIN = { origin: 'http://localhost:3001' };

interface SessionRow {
  id: string;
  token: string;
  userAgent: string | null;
}

function isSessionList(value: unknown): value is SessionRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        'id' in row &&
        typeof row.id === 'string' &&
        'token' in row &&
        typeof row.token === 'string'
    )
  );
}

function isWorkspaceList(value: unknown): value is { id: string }[] {
  return (
    Array.isArray(value) &&
    value.every((row) => typeof row === 'object' && row !== null && 'id' in row)
  );
}

describe.skipIf(!integrationEnabled)('workspace settings', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setupHarness();
  }, 120_000);

  async function workspaceName(id: string): Promise<string | undefined> {
    const [row] = await h.db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, id));
    return row?.name;
  }

  async function isMember(workspaceId: string, userId: string): Promise<boolean> {
    const rows = await h.db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))
      );
    return rows.length > 0;
  }

  it('lets owners and admins rename the workspace, not members', async () => {
    const ws = h.seed.workspaceA.id;

    const member = await h.request('memberA', 'PATCH', `/api/workspaces/${ws}`, { name: 'Nope' });
    expect(member.status).toBe(403);
    expect(await workspaceName(ws)).toBe('Workspace A');

    const admin = await h.request('adminA', 'PATCH', `/api/workspaces/${ws}`, { name: 'By admin' });
    expect(admin.status).toBe(200);
    expect(await workspaceName(ws)).toBe('By admin');

    const owner = await h.request('ownerA', 'PATCH', `/api/workspaces/${ws}`, { name: 'By owner' });
    expect(owner.status).toBe(200);
    expect(await workspaceName(ws)).toBe('By owner');
  });

  it('rejects an empty or too long name', async () => {
    const ws = h.seed.workspaceA.id;
    expect((await h.request('ownerA', 'PATCH', `/api/workspaces/${ws}`, { name: '' })).status).toBe(
      400
    );
    expect(
      (await h.request('ownerA', 'PATCH', `/api/workspaces/${ws}`, { name: 'x'.repeat(101) }))
        .status
    ).toBe(400);
    expect(await workspaceName(ws)).toBe('Workspace A');
  });

  it('only the owner can delete the workspace', async () => {
    const ws = h.seed.workspaceA.id;
    expect((await h.request('adminA', 'DELETE', `/api/workspaces/${ws}`)).status).toBe(403);
    expect((await h.request('memberA', 'DELETE', `/api/workspaces/${ws}`)).status).toBe(403);
    expect(await workspaceName(ws)).toBe('Workspace A');

    expect((await h.request('ownerA', 'DELETE', `/api/workspaces/${ws}`)).status).toBe(200);
    expect(await workspaceName(ws)).toBeUndefined();
    expect([403, 404]).toContain(
      (await h.request('ownerA', 'GET', `/api/workspaces/${ws}`)).status
    );
  });

  it('a member leaves by removing themselves, emits member.left and loses access', async () => {
    const ws = h.seed.workspaceA.id;
    const memberId = h.seed.users.memberA.id;
    const left: { workspaceId: string; userId: string }[] = [];
    const off = domainEvents.on('member.left', (payload) => {
      left.push(payload);
    });
    try {
      const res = await h.request('memberA', 'DELETE', `/api/workspaces/${ws}/members/${memberId}`);
      expect(res.status).toBe(200);
    } finally {
      off();
    }

    expect(left).toEqual([{ workspaceId: ws, userId: memberId }]);
    expect(await isMember(ws, memberId)).toBe(false);
    expect([403, 404]).toContain(
      (await h.request('memberA', 'GET', `/api/workspaces/${ws}`)).status
    );
    expect([403, 404]).toContain(
      (await h.request('memberA', 'GET', `/api/projects/${h.seed.projectA.id}`)).status
    );
    const list = await h.request('memberA', 'GET', '/api/workspaces');
    expect(list.status).toBe(200);
    expect(isWorkspaceList(list.body.data) && list.body.data.map((w) => w.id)).toEqual([]);
  });

  it('an admin can leave; a member cannot remove someone else', async () => {
    const ws = h.seed.workspaceA.id;
    expect(
      (
        await h.request(
          'memberA',
          'DELETE',
          `/api/workspaces/${ws}/members/${h.seed.users.insiderA.id}`
        )
      ).status
    ).toBe(403);
    expect(await isMember(ws, h.seed.users.insiderA.id)).toBe(true);

    expect(
      (
        await h.request(
          'adminA',
          'DELETE',
          `/api/workspaces/${ws}/members/${h.seed.users.adminA.id}`
        )
      ).status
    ).toBe(200);
    expect(await isMember(ws, h.seed.users.adminA.id)).toBe(false);
  });

  it('the only owner cannot leave; one of two owners can', async () => {
    const ws = h.seed.workspaceA.id;
    const ownerId = h.seed.users.ownerA.id;
    const sole = await h.request('ownerA', 'DELETE', `/api/workspaces/${ws}/members/${ownerId}`);
    expect(sole.status).toBe(409);
    expect(sole.body.error?.message).toBe('Cannot remove the last owner');
    expect(await isMember(ws, ownerId)).toBe(true);

    await h.db
      .update(workspaceMembers)
      .set({ role: 'owner' })
      .where(
        and(
          eq(workspaceMembers.workspaceId, ws),
          eq(workspaceMembers.userId, h.seed.users.adminA.id)
        )
      );
    expect(
      (await h.request('ownerA', 'DELETE', `/api/workspaces/${ws}/members/${ownerId}`)).status
    ).toBe(200);
    expect(await isMember(ws, ownerId)).toBe(false);
  });
});

describe.skipIf(!integrationEnabled)('profile endpoints (Better Auth)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setupHarness();
  }, 120_000);

  it('updates the display name and serves it from get-session', async () => {
    const res = await h.request(
      'memberA',
      'POST',
      '/api/auth/update-user',
      { name: 'Ada' },
      ORIGIN
    );
    expect(res.status).toBe(200);
    const [row] = await h.db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, h.seed.users.memberA.id));
    expect(row?.name).toBe('Ada');

    const session = await h.request('memberA', 'GET', '/api/auth/get-session');
    expect(session.text).toContain('"name":"Ada"');
  });

  it('does not let a user change their email', async () => {
    const res = await h.request(
      'memberA',
      'POST',
      '/api/auth/update-user',
      { email: 'evil@example.test' },
      ORIGIN
    );
    expect(res.status).toBe(400);
    const [row] = await h.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, h.seed.users.memberA.id));
    expect(row?.email).toBe(h.seed.users.memberA.email);
  });

  it('lists only the caller’s sessions and revokes another one', async () => {
    const userId = h.seed.users.memberA.id;
    await h.db.insert(sessions).values({
      userId,
      token: `other-${crypto.randomUUID()}`,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const listed = await h.request('memberA', 'GET', '/api/auth/list-sessions');
    expect(listed.status).toBe(200);
    const list: unknown = JSON.parse(listed.text);
    if (!isSessionList(list)) throw new Error(`unexpected list-sessions body: ${listed.text}`);
    expect(list).toHaveLength(2);
    const other = list.find((s) => s.id !== h.seed.users.memberA.sessionId);
    expect(other?.userAgent).toContain('iPhone');

    const revoked = await h.request(
      'memberA',
      'POST',
      '/api/auth/revoke-session',
      { token: other?.token ?? '' },
      ORIGIN
    );
    expect(revoked.status).toBe(200);
    const left = await h.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, userId));
    expect(left.map((s) => s.id)).toEqual([h.seed.users.memberA.sessionId]);
  });

  it('cannot revoke another user’s session', async () => {
    const [victim] = await h.db
      .select({ token: sessions.token })
      .from(sessions)
      .where(eq(sessions.id, h.seed.users.ownerA.sessionId));
    await h.request(
      'memberA',
      'POST',
      '/api/auth/revoke-session',
      { token: victim?.token ?? '' },
      ORIGIN
    );
    const still = await h.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, h.seed.users.ownerA.sessionId));
    expect(still).toHaveLength(1);
  });

  it('signs out of every other session but keeps the current one', async () => {
    const userId = h.seed.users.memberA.id;
    for (let i = 0; i < 2; i++) {
      await h.db.insert(sessions).values({
        userId,
        token: `other-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
    }
    const res = await h.request('memberA', 'POST', '/api/auth/revoke-other-sessions', {}, ORIGIN);
    expect(res.status).toBe(200);
    const left = await h.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, userId));
    expect(left.map((s) => s.id)).toEqual([h.seed.users.memberA.sessionId]);
    // Other users keep their sessions.
    expect(
      await h.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, h.seed.users.ownerA.sessionId))
    ).toHaveLength(1);
  });
});
