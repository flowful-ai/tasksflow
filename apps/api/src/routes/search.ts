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
import { getDatabase } from '../db/index.js';
import { SearchService } from '../domain/index.js';
import { getAuthz, requireWorkspace } from '../lib/authorize.js';
import { handleRouteError } from '../lib/responses.js';
import { SearchQuerySchema } from '@flowtask/shared';

const searchRoutes = new Hono();
searchRoutes.onError(handleRouteError);
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
  const { workspaceId, q, limit } = c.req.valid('query');
  const { user, role } = await requireWorkspace(c, workspaceId, 'task:read');
  const projectIds = await getAuthz().listAccessibleProjectIds(workspaceId, user.id, role);

  const result = await searchService.search({ projectIds, q, limit });
  if (!result.ok) {
    console.error('[search]', result.error);
    return fail(c, 500, 'SEARCH_FAILED', 'Search failed');
  }
  return c.json({ success: true, data: result.value });
});

export { searchRoutes };
