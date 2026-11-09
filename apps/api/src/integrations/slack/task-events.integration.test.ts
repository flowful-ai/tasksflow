/**
 * Slack enqueue gate: projects without an enabled Slack integration are
 * cached per project and cleared when an integration is saved or deleted.
 */
import { describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { projectIntegrations } from '../../db/index.js';
import {
  TEST_DATABASE_URL,
  createProject,
  createWorkspace,
  testDb,
} from '../../domain/task/test-fixtures.js';
import {
  SLACK_PROJECT_CACHE_TTL_MS,
  clearSlackProjectCache,
  slackEnabledForProject,
} from './task-events.js';

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
});
