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
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '../db/index.js';
import { NotificationService, type NotificationRecord } from '../domain/index.js';
import { requireUser, requireWorkspace } from '../lib/authorize.js';
import {
  badRequest,
  fromResult,
  notFound,
  validationHook,
  handleRouteError,
} from '../lib/responses.js';
import {
  ListNotificationsQuerySchema,
  ReadAllNotificationsSchema,
  SnoozeNotificationSchema,
  UnreadCountQuerySchema,
  type Result,
} from '@flowtask/shared';

const notificationRoutes = new Hono();
notificationRoutes.onError(handleRouteError);
const db = getDatabase();
const notificationService = new NotificationService(db);

const IdParamSchema = z.object({ id: z.string().uuid() });

const UPDATE_FAILED = { code: 'NOTIFICATION_FAILED', message: 'Failed to update notification' };

function updated(result: Result<NotificationRecord | null, Error>): NotificationRecord {
  const record = fromResult(result, UPDATE_FAILED);
  if (!record) throw notFound('Notification');
  return record;
}

notificationRoutes.get(
  '/',
  zValidator('query', ListNotificationsQuerySchema, validationHook),
  async (c) => {
    const query = c.req.valid('query');
    const { user } = await requireWorkspace(c, query.workspaceId, 'workspace:read');
    const page = fromResult(await notificationService.list(user.id, query), {
      code: 'NOTIFICATION_FAILED',
      message: 'Failed to load notifications',
    });
    return c.json({ success: true, data: page.items, meta: { nextCursor: page.nextCursor } });
  }
);

notificationRoutes.get(
  '/unread-count',
  zValidator('query', UnreadCountQuerySchema, validationHook),
  async (c) => {
    const { workspaceId } = c.req.valid('query');
    const { user } = await requireWorkspace(c, workspaceId, 'workspace:read');
    const count = fromResult(await notificationService.unreadCount(user.id, workspaceId), {
      code: 'NOTIFICATION_FAILED',
      message: 'Failed to count notifications',
    });
    return c.json({ success: true, data: { count } });
  }
);

notificationRoutes.post(
  '/read-all',
  zValidator('json', ReadAllNotificationsSchema, validationHook),
  async (c) => {
    const user = requireUser(c);
    const { workspaceId } = c.req.valid('json');
    const count = fromResult(await notificationService.markAllRead(user.id, workspaceId), {
      code: 'NOTIFICATION_FAILED',
      message: 'Failed to update notifications',
    });
    return c.json({ success: true, data: { updated: count } });
  }
);

notificationRoutes.post(
  '/:id/read',
  zValidator('param', IdParamSchema, validationHook),
  async (c) => {
    const record = updated(
      await notificationService.markRead(requireUser(c).id, c.req.valid('param').id)
    );
    return c.json({ success: true, data: record });
  }
);

notificationRoutes.post(
  '/:id/unread',
  zValidator('param', IdParamSchema, validationHook),
  async (c) => {
    const record = updated(
      await notificationService.markUnread(requireUser(c).id, c.req.valid('param').id)
    );
    return c.json({ success: true, data: record });
  }
);

notificationRoutes.post(
  '/:id/archive',
  zValidator('param', IdParamSchema, validationHook),
  async (c) => {
    const record = updated(
      await notificationService.archive(requireUser(c).id, c.req.valid('param').id)
    );
    return c.json({ success: true, data: record });
  }
);

notificationRoutes.post(
  '/:id/unarchive',
  zValidator('param', IdParamSchema, validationHook),
  async (c) => {
    const record = updated(
      await notificationService.unarchive(requireUser(c).id, c.req.valid('param').id)
    );
    return c.json({ success: true, data: record });
  }
);

notificationRoutes.post(
  '/:id/snooze',
  zValidator('param', IdParamSchema, validationHook),
  zValidator('json', SnoozeNotificationSchema, validationHook),
  async (c) => {
    const { until } = c.req.valid('json');
    if (until.getTime() <= Date.now()) {
      throw badRequest('`until` must be in the future', 'VALIDATION_ERROR');
    }
    const record = updated(
      await notificationService.snooze(requireUser(c).id, c.req.valid('param').id, until)
    );
    return c.json({ success: true, data: record });
  }
);

export { notificationRoutes };
