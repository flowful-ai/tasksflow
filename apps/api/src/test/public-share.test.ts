import { beforeEach, describe, expect, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { publicShares, workspaceMembers } from '../db/index.js';
import { SHARE_PASSWORD_LIMITS } from '../domain/index.js';
import { integrationEnabled, setupHarness, type Harness } from './harness.js';

describe.skipIf(!integrationEnabled)('public shares', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setupHarness();
  }, 120_000);

  async function createShare(body: object): Promise<string> {
    const res = await h.request(
      'adminA',
      'POST',
      `/api/smart-views/${h.seed.teamViewA}/public`,
      body
    );
    expect(res.status).toBe(201);
    const data = res.body.data;
    if (
      typeof data !== 'object' ||
      data === null ||
      !('token' in data) ||
      typeof data.token !== 'string'
    ) {
      throw new Error('share token missing');
    }
    return data.token;
  }

  it('returns an allow-listed DTO without emails, app roles or GitHub links', async () => {
    const res = await h.request(null, 'GET', `/api/public/share/${h.seed.publicShareA.token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Open task A');
    expect(res.text).toContain('"name":"memberA"');
    expect(res.text).not.toContain('@example.test');
    expect(res.text).not.toContain('appRole');
    expect(res.text).not.toContain('emailVerified');
    expect(res.text).not.toContain('externalLinks');
    expect(res.text).not.toContain('createdBy');
    // hideFields: ['due_date'] on the seeded share
    expect(res.text).not.toContain('dueDate');
    expect(res.text).not.toContain('2030-01-01');
  });

  it('hides nested data for hidden fields', async () => {
    const token = await createShare({ hideFields: ['assignee', 'state', 'labels', 'project'] });
    const res = await h.request(null, 'GET', `/api/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('"assignees"');
    expect(res.text).not.toContain('memberA');
    expect(res.text).not.toContain('"state":{');
    expect(res.text).not.toContain('"stateId"');
    expect(res.text).not.toContain('"labels"');
    expect(res.text).not.toContain('"project":{');
    expect(res.text).not.toContain('"projectId"');
  });

  it("runs with the creator's access and dies when the creator loses it", async () => {
    const before = await h.request(null, 'GET', `/api/public/share/${h.seed.publicShareA.token}`);
    expect(before.text).toContain('Secret task A'); // admin creator sees restricted projects

    await h.db
      .update(workspaceMembers)
      .set({ role: 'member' })
      .where(
        and(
          eq(workspaceMembers.workspaceId, h.seed.workspaceA.id),
          eq(workspaceMembers.userId, h.seed.users.adminA.id)
        )
      );
    const after = await h.request(null, 'GET', `/api/public/share/${h.seed.publicShareA.token}`);
    expect(after.status).toBe(404);
  });

  it('returns 404 for unknown, malformed and disabled tokens', async () => {
    expect((await h.request(null, 'GET', `/api/public/share/${crypto.randomUUID()}`)).status).toBe(
      404
    );
    expect((await h.request(null, 'GET', '/api/public/share/not-a-uuid')).status).toBe(404);
    await h.db
      .update(publicShares)
      .set({ isActive: false })
      .where(eq(publicShares.id, h.seed.publicShareA.id));
    expect(
      (await h.request(null, 'GET', `/api/public/share/${h.seed.publicShareA.token}`)).status
    ).toBe(404);
  });

  it('requires the password and accepts the right one', async () => {
    const token = await createShare({ password: 'correct horse' });
    const locked = await h.request(null, 'GET', `/api/public/share/${token}`);
    expect(locked.body.data).toMatchObject({ requiresPassword: true });
    expect(locked.text).not.toContain('Open task A');

    const wrong = await h.request(null, 'POST', `/api/public/share/${token}/verify`, {
      password: 'nope',
    });
    expect(wrong.status).toBe(401);
    const right = await h.request(null, 'POST', `/api/public/share/${token}/verify`, {
      password: 'correct horse',
    });
    expect(right.status).toBe(200);
    expect(right.text).toContain('Open task A');
  });

  it('locks out an IP after repeated failures, even for the right password', async () => {
    const token = await createShare({ password: 'correct horse' });
    const headers = { 'x-forwarded-for': '203.0.113.10' };
    for (let i = 0; i < SHARE_PASSWORD_LIMITS.perIpAndToken; i++) {
      expect(
        (
          await h.request(
            null,
            'POST',
            `/api/public/share/${token}/verify`,
            { password: `bad-${i}` },
            headers
          )
        ).status
      ).toBe(401);
    }
    const blocked = await h.request(
      null,
      'POST',
      `/api/public/share/${token}/verify`,
      { password: 'correct horse' },
      headers
    );
    expect(blocked.status).toBe(429);

    // A different client is not affected by this IP's lockout.
    const other = await h.request(
      null,
      'POST',
      `/api/public/share/${token}/verify`,
      { password: 'correct horse' },
      {
        'x-forwarded-for': '203.0.113.11',
      }
    );
    expect(other.status).toBe(200);
  }, 60_000);

  it('cannot be bypassed by spoofing X-Forwarded-For', async () => {
    const token = await createShare({ password: 'correct horse' });
    for (let i = 0; i < SHARE_PASSWORD_LIMITS.perIpAndToken; i++) {
      // The client controls everything left of the entry appended by the trusted proxy.
      const spoofed = { 'x-forwarded-for': `10.9.${i}.1, 198.51.100.7` };
      await h.request(
        null,
        'POST',
        `/api/public/share/${token}/verify`,
        { password: 'bad' },
        spoofed
      );
    }
    const res = await h.request(
      null,
      'POST',
      `/api/public/share/${token}/verify`,
      { password: 'bad' },
      {
        'x-forwarded-for': '1.2.3.4, 198.51.100.7',
      }
    );
    expect(res.status).toBe(429);
  }, 60_000);

  it('locks the token itself regardless of IP', async () => {
    const token = await createShare({ password: 'correct horse' });
    for (let i = 0; i < SHARE_PASSWORD_LIMITS.perToken; i++) {
      await h.request(
        null,
        'POST',
        `/api/public/share/${token}/verify`,
        { password: 'bad' },
        {
          'x-forwarded-for': `192.0.2.${i + 1}`,
        }
      );
    }
    const res = await h.request(
      null,
      'POST',
      `/api/public/share/${token}/verify`,
      { password: 'correct horse' },
      {
        'x-forwarded-for': '192.0.2.250',
      }
    );
    expect(res.text).not.toContain('Open task A');
    expect(res.status).toBe(429);
  }, 60_000);

  it('counts attempts before verifying, so parallel guesses cannot exceed the limit', async () => {
    const token = await createShare({ password: 'correct horse' });
    const headers = { 'x-forwarded-for': '203.0.113.99' };
    const total = SHARE_PASSWORD_LIMITS.perIpAndToken + 15;
    const results = await Promise.all(
      Array.from({ length: total }, () =>
        h.request(null, 'POST', `/api/public/share/${token}/verify`, { password: 'bad' }, headers)
      )
    );
    const verified = results.filter((r) => r.status === 401).length;
    expect(verified).toBeLessThanOrEqual(SHARE_PASSWORD_LIMITS.perIpAndToken);
    expect(results.filter((r) => r.status === 429).length).toBe(total - verified);
  }, 60_000);
});
