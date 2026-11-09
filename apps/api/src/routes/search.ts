/**
 * ⌘K palette search. Mounted at /api/search.
 *
 *   GET /?workspaceId=&q=&limit=   → { tasks: SearchTaskHit[], projects: SearchProjectHit[] }
 *
 * Scoped to the projects the caller can access (workspace membership +
 * project ACL). A task key such as "TF-12" is matched exactly and ranked first.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '../db/index.js';
import { SearchService } from '../domain/index.js';
import { getAuthz, requireWorkspace } from '../lib/authorize.js';
import { fromResult, handleRouteError, validationHook } from '../lib/responses.js';
import { SearchQuerySchema } from '@flowtask/shared';

const searchRoutes = new Hono();
searchRoutes.onError(handleRouteError);
const db = getDatabase();
const searchService = new SearchService(db);

searchRoutes.get('/', zValidator('query', SearchQuerySchema, validationHook), async (c) => {
  const { workspaceId, q, limit } = c.req.valid('query');
  const { user, role } = await requireWorkspace(c, workspaceId, 'task:read');
  const projectIds = await getAuthz().listAccessibleProjectIds(workspaceId, user.id, role);

  const results = fromResult(await searchService.search({ projectIds, q, limit }), {
    code: 'SEARCH_FAILED',
    message: 'Search failed',
  });
  return c.json({ success: true, data: results });
});

export { searchRoutes };
