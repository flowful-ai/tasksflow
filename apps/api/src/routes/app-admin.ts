import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '../db/index.js';
import { AppAdminService } from '../domain/index.js';
import { AppUsersListQuerySchema, UpdateAppUserRoleSchema } from '@flowtask/shared';
import { requireUser } from '../lib/authorize.js';
import { AppError, forbidden, fromResult, handleRouteError, notFound } from '../lib/responses.js';

const appAdminRoutes = new Hono();
appAdminRoutes.onError(handleRouteError);

const db = getDatabase();
const appAdminService = new AppAdminService(db);

/** Known, user-facing AppAdminService errors; anything else is internal. */
function mapServiceError(error: Error): AppError {
  switch (error.message) {
    case 'Only app managers can manage user roles':
      return forbidden(error.message);
    case 'Cannot demote the last app manager':
      return new AppError(409, 'LAST_APP_MANAGER', error.message);
    case 'User not found':
      return notFound('User');
    default:
      console.error('[app-admin] role update failed:', error);
      return new AppError(500, 'UPDATE_FAILED', 'Failed to update user role');
  }
}

async function requireAppManager(userId: string): Promise<void> {
  const contextResult = await appAdminService.getAppContext(userId);
  if (!contextResult.ok) throw notFound('User');
  if (!contextResult.value.isAppManager)
    throw forbidden('Only app managers can access app settings');
}

appAdminRoutes.get('/me', async (c) => {
  const user = requireUser(c);
  const contextResult = await appAdminService.getAppContext(user.id);
  if (!contextResult.ok) throw notFound('User');
  return c.json({ success: true, data: contextResult.value });
});

appAdminRoutes.get('/users', zValidator('query', AppUsersListQuerySchema), async (c) => {
  const user = requireUser(c);
  await requireAppManager(user.id);

  const result = fromResult(await appAdminService.listUsers(c.req.valid('query')), {
    code: 'LIST_FAILED',
    message: 'Failed to list users',
  });
  return c.json({ success: true, data: result });
});

appAdminRoutes.patch(
  '/users/:userId/role',
  zValidator('json', UpdateAppUserRoleSchema),
  async (c) => {
    const user = requireUser(c);
    await requireAppManager(user.id);

    const { appRole } = c.req.valid('json');
    const result = await appAdminService.updateUserRole({
      targetUserId: c.req.param('userId'),
      appRole,
      actorUserId: user.id,
    });
    if (!result.ok) throw mapServiceError(result.error);

    return c.json({ success: true, data: result.value });
  }
);

export { appAdminRoutes };
