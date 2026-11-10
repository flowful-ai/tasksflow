/**
 * Every zValidator answers a bad request with the standard error envelope
 * ({ code: 'VALIDATION_ERROR', message: <first issue> }). Without the shared
 * validationHook, @hono/zod-validator serialises the raw ZodError, whose
 * `message` under zod 4 is the whole issue list as a JSON string, and the web
 * client would show that string in a toast. Skipped unless TEST_DATABASE_URL
 * is set.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { integrationEnabled, setupHarness, type Harness } from '../test/harness.js';

describe.skipIf(!integrationEnabled)('validation errors', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  it('answers 400 VALIDATION_ERROR with a readable message', async () => {
    const s = h.seed;
    const cases: Array<{ method: string; path: string; body?: object }> = [
      { method: 'POST', path: '/api/projects', body: { workspaceId: 'not-a-uuid', name: 'P' } },
      { method: 'PATCH', path: `/api/smart-views/${s.teamViewA}`, body: { name: 42 } },
      { method: 'POST', path: `/api/tasks/${s.taskA}/comments`, body: {} },
      { method: 'POST', path: '/api/tasks', body: { projectId: s.projectA.id } },
    ];
    for (const { method, path, body } of cases) {
      const res = await h.request('ownerA', method, path, body);
      expect({ path, status: res.status }).toEqual({ path, status: 400 });
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
      expect(typeof res.body.error?.message).toBe('string');
      expect(res.body.error?.message).not.toContain('"code"');
    }

    const comment = await h.request('ownerA', 'POST', `/api/tasks/${s.taskA}/comments`, {});
    expect(comment.body.error?.message).toStartWith('content: ');
  });
});
