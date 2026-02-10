import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '@flowtask/database';
import { AppAdminService } from '@flowtask/domain';
import { getCurrentUser } from '@flowtask/auth';
import { AppUsersListQuerySchema, UpdateAppUserRoleSchema } from '@flowtask/shared';

const appAdminRoutes = new Hono();
const db = getDatabase();
const appAdminService = new AppAdminService(db);

function mapServiceError(error: Error): { status: 400 | 403 | 404 | 409 | 500; code: string } {
  switch (error.message) {
    case 'Only app managers can manage user roles':
      return { status: 403, code: 'FORBIDDEN' };
    case 'Cannot demote the last app manager':
      return { status: 409, code: 'LAST_APP_MANAGER' };
    case 'User not found':
      return { status: 404, code: 'NOT_FOUND' };
    default:
      return { status: 400, code: 'BAD_REQUEST' };
  }
}

async function requireAppManager(userId: string): Promise<{ allowed: true } | { allowed: false; status: 403 | 404; message: string }> {
  const contextResult = await appAdminService.getAppContext(userId);
  if (!contextResult.ok) {
    return { allowed: false, status: 404, message: contextResult.error.message };
  }

  if (!contextResult.value.isAppManager) {
    return { allowed: false, status: 403, message: 'Only app managers can access app settings' };
  }

  return { allowed: true };
}

appAdminRoutes.get('/me', async (c) => {
  const user = getCurrentUser(c);
  const contextResult = await appAdminService.getAppContext(user.id);

  if (!contextResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: contextResult.error.message } }, 404);
  }

  return c.json({ success: true, data: contextResult.value });
});

appAdminRoutes.get(
  '/users',
  zValidator('query', AppUsersListQuerySchema),
  async (c) => {
    const user = getCurrentUser(c);
    const guard = await requireAppManager(user.id);
    if (!guard.allowed) {
      const code = guard.status === 404 ? 'NOT_FOUND' : 'FORBIDDEN';
      return c.json({ success: false, error: { code, message: guard.message } }, guard.status);
    }

    const query = c.req.valid('query');
    const result = await appAdminService.listUsers(query);

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
    }

    return c.json({ success: true, data: result.value });
  }
);

appAdminRoutes.patch(
  '/users/:userId/role',
  zValidator('json', UpdateAppUserRoleSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const guard = await requireAppManager(user.id);
    if (!guard.allowed) {
      const code = guard.status === 404 ? 'NOT_FOUND' : 'FORBIDDEN';
      return c.json({ success: false, error: { code, message: guard.message } }, guard.status);
    }

    const targetUserId = c.req.param('userId');
    const { appRole } = c.req.valid('json');

    const result = await appAdminService.updateUserRole({
      targetUserId,
      appRole,
      actorUserId: user.id,
    });

    if (!result.ok) {
      const mapped = mapServiceError(result.error);
      return c.json({ success: false, error: { code: mapped.code, message: result.error.message } }, mapped.status);
    }

    return c.json({ success: true, data: result.value });
  }
);

export { appAdminRoutes };
