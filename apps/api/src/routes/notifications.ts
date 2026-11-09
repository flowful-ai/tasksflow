/**
 * Inbox notifications of the current user. Mounted at /api/notifications.
 *
 *   GET  /?workspaceId=&filter=inbox|unread|archived|snoozed|all&cursor=&limit=
 *        → NotificationItem[] (newest first), meta.nextCursor
 *   GET  /unread-count?workspaceId=     → { count }
 *   POST /read-all { workspaceId }      → { updated }
 *   POST /:id/read | /:id/unread | /:id/archive | /:id/unarchive  → notification
 *   POST /:id/snooze { until }          → notification (hidden until `until`, returns unread)
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '@flowtask/database';
import { NotificationService, type NotificationRecord } from '@flowtask/domain';
import { getAuthz } from '../lib/authorize.js';
import { getCurrentUser } from '@flowtask/auth';
import {
  ListNotificationsQuerySchema,
  ReadAllNotificationsSchema,
  SnoozeNotificationSchema,
  UnreadCountQuerySchema,
  type Result,
} from '@flowtask/shared';

const notificationRoutes = new Hono();
const db = getDatabase();
const notificationService = new NotificationService(db);

const IdParamSchema = z.object({ id: z.string().uuid() });

function fail(c: Context, status: 400 | 403 | 404 | 500, code: string, message: string) {
  return c.json({ success: false, error: { code, message } }, status);
}

const validationHook = (result: { success: boolean; error?: z.ZodError }, c: Context) => {
  if (!result.success) {
    return fail(c, 400, 'VALIDATION_ERROR', result.error?.issues[0]?.message ?? 'Invalid request');
  }
};

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  return (await getAuthz().getRole(workspaceId, userId)) !== null;
}

function respond(c: Context, result: Result<NotificationRecord | null, Error>) {
  if (!result.ok) {
    console.error('[notifications]', result.error);
    return fail(c, 500, 'NOTIFICATION_FAILED', 'Failed to update notification');
  }
  if (!result.value) return fail(c, 404, 'NOT_FOUND', 'Notification not found');
  return c.json({ success: true, data: result.value });
}

notificationRoutes.get('/', zValidator('query', ListNotificationsQuerySchema, validationHook), async (c) => {
  const user = getCurrentUser(c);
  const query = c.req.valid('query');
  if (!(await isMember(query.workspaceId, user.id))) return fail(c, 403, 'FORBIDDEN', 'Not authorized');
  const result = await notificationService.list(user.id, query);
  if (!result.ok) {
    console.error('[notifications]', result.error);
    return fail(c, 500, 'NOTIFICATION_FAILED', 'Failed to load notifications');
  }
  return c.json({ success: true, data: result.value.items, meta: { nextCursor: result.value.nextCursor } });
});

notificationRoutes.get('/unread-count', zValidator('query', UnreadCountQuerySchema, validationHook), async (c) => {
  const user = getCurrentUser(c);
  const { workspaceId } = c.req.valid('query');
  if (!(await isMember(workspaceId, user.id))) return fail(c, 403, 'FORBIDDEN', 'Not authorized');
  const result = await notificationService.unreadCount(user.id, workspaceId);
  if (!result.ok) return fail(c, 500, 'NOTIFICATION_FAILED', 'Failed to count notifications');
  return c.json({ success: true, data: { count: result.value } });
});

notificationRoutes.post('/read-all', zValidator('json', ReadAllNotificationsSchema, validationHook), async (c) => {
  const user = getCurrentUser(c);
  const { workspaceId } = c.req.valid('json');
  const result = await notificationService.markAllRead(user.id, workspaceId);
  if (!result.ok) return fail(c, 500, 'NOTIFICATION_FAILED', 'Failed to update notifications');
  return c.json({ success: true, data: { updated: result.value } });
});

notificationRoutes.post('/:id/read', zValidator('param', IdParamSchema, validationHook), async (c) => {
  return respond(c, await notificationService.markRead(getCurrentUser(c).id, c.req.valid('param').id));
});

notificationRoutes.post('/:id/unread', zValidator('param', IdParamSchema, validationHook), async (c) => {
  return respond(c, await notificationService.markUnread(getCurrentUser(c).id, c.req.valid('param').id));
});

notificationRoutes.post('/:id/archive', zValidator('param', IdParamSchema, validationHook), async (c) => {
  return respond(c, await notificationService.archive(getCurrentUser(c).id, c.req.valid('param').id));
});

notificationRoutes.post('/:id/unarchive', zValidator('param', IdParamSchema, validationHook), async (c) => {
  return respond(c, await notificationService.unarchive(getCurrentUser(c).id, c.req.valid('param').id));
});

notificationRoutes.post(
  '/:id/snooze',
  zValidator('param', IdParamSchema, validationHook),
  zValidator('json', SnoozeNotificationSchema, validationHook),
  async (c) => {
    const { until } = c.req.valid('json');
    if (until.getTime() <= Date.now()) return fail(c, 400, 'VALIDATION_ERROR', '`until` must be in the future');
    return respond(c, await notificationService.snooze(getCurrentUser(c).id, c.req.valid('param').id, until));
  }
);

export { notificationRoutes };
