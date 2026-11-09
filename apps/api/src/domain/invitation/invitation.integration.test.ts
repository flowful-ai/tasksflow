/**
 * Invitation accept under concurrency (skipped unless TEST_DATABASE_URL is set).
 */
import { describe, expect, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { workspaceInvitations, workspaceMembers } from '../../db/index.js';
import {
  TEST_DATABASE_URL,
  createUser,
  createWorkspace,
  testDb,
  unwrap,
} from '../task/test-fixtures.js';
import { isDomainError } from '../workspace/errors.js';
import { InvitationService } from './service.js';

describe.skipIf(!TEST_DATABASE_URL)('invitations (integration)', () => {
  it('a 2-use link admits exactly 2 of 6 concurrent accepts', async () => {
    const db = testDb();
    const ws = await createWorkspace(db);
    const service = new InvitationService(db);
    const invitation = unwrap(
      await service.create({
        workspaceId: ws.workspaceId,
        email: null,
        role: 'member',
        invitedBy: ws.owner.id,
        maxUses: 2,
      })
    );
    const candidates = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createUser(db, `Candidate ${i}`))
    );

    const results = await Promise.all(
      candidates.map((user) => service.accept({ token: invitation.token, userId: user.id }))
    );

    expect(results.filter((r) => r.ok)).toHaveLength(2);
    // Every rejection is the client-safe usage-limit error, never a DB error.
    for (const result of results) {
      if (!result.ok) {
        expect(isDomainError(result.error)).toBe(true);
        expect(result.error.message).toMatch(/usage limit/);
      }
    }

    const joined = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, ws.workspaceId), eq(workspaceMembers.role, 'member'))
      );
    // The fixture's own member plus exactly two candidates.
    expect(joined.filter((row) => candidates.some((c) => c.id === row.userId))).toHaveLength(2);

    const [row] = await db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.id, invitation.id));
    expect(row?.usesCount).toBe(2);
    expect(row?.status).toBe('exhausted');
  });

  it('accepting twice reports "already a member" without consuming a use', async () => {
    const db = testDb();
    const ws = await createWorkspace(db);
    const service = new InvitationService(db);
    const invitation = unwrap(
      await service.create({
        workspaceId: ws.workspaceId,
        email: null,
        role: 'member',
        invitedBy: ws.owner.id,
        maxUses: 5,
      })
    );
    const user = await createUser(db, 'Twice');
    expect((await service.accept({ token: invitation.token, userId: user.id })).ok).toBe(true);
    const again = await service.accept({ token: invitation.token, userId: user.id });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toMatch(/already a member/);

    const [row] = await db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.id, invitation.id));
    expect(row?.usesCount).toBe(1);
  });

  it('rejects an invitation with an invalid stored role with a client-safe error', async () => {
    const db = testDb();
    const ws = await createWorkspace(db);
    const service = new InvitationService(db);
    const invitation = unwrap(
      await service.create({
        workspaceId: ws.workspaceId,
        email: null,
        role: 'member',
        invitedBy: ws.owner.id,
        maxUses: 5,
      })
    );
    await db
      .update(workspaceInvitations)
      .set({ role: 'superuser' })
      .where(eq(workspaceInvitations.id, invitation.id));
    const user = await createUser(db, 'Bad role');

    const result = await service.accept({ token: invitation.token, userId: user.id });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isDomainError(result.error) && result.error.code).toBe('BAD_REQUEST');
    }
    const members = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, ws.workspaceId), eq(workspaceMembers.userId, user.id))
      );
    expect(members).toEqual([]);
  });
});
