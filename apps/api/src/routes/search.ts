/**
 * ⌘K palette search. Mounted at /api/search.
 *
 *   GET /?workspaceId=&q=&limit=   → { tasks: SearchTaskHit[], projects: SearchProjectHit[] }
 *
 * Scoped to the projects the caller can access (workspace membership +
 * project ACL). A task key such as "TF-12" is matched exactly and ranked first.
 */
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '@flowtask/database';
import { SearchService, getWorkspaceRole, listAccessibleProjectIds } from '@flowtask/domain';
import { getCurrentUser, hasPermission } from '@flowtask/auth';
import { SearchQuerySchema } from '@flowtask/shared';

const searchRoutes = new Hono();
const db = getDatabase();
const searchService = new SearchService(db);

function fail(c: Context, status: 400 | 403 | 500, code: string, message: string) {
  return c.json({ success: false, error: { code, message } }, status);
}

const validationHook = (result: { success: boolean; error?: z.ZodError }, c: Context) => {
  if (!result.success) {
    return fail(c, 400, 'VALIDATION_ERROR', result.error?.issues[0]?.message ?? 'Invalid request');
  }
};

searchRoutes.get('/', zValidator('query', SearchQuerySchema, validationHook), async (c) => {
  const user = getCurrentUser(c);
  const { workspaceId, q, limit } = c.req.valid('query');

  // TODO(authz): replace with the central authorize() helper.
  const role = await getWorkspaceRole(db, workspaceId, user.id);
  if (!role || !hasPermission(role, 'task:read')) return fail(c, 403, 'FORBIDDEN', 'Not authorized');
  const projectIds = await listAccessibleProjectIds(db, workspaceId, user.id);

  const result = await searchService.search({ projectIds, q, limit });
  if (!result.ok) {
    console.error('[search]', result.error);
    return fail(c, 500, 'SEARCH_FAILED', 'Search failed');
  }
  return c.json({ success: true, data: result.value });
});

export { searchRoutes };
