import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { Redis } from 'ioredis';
import { getDatabase } from '@flowtask/database';
import { SmartViewService, TaskService, RateLimitService } from '@flowtask/domain';

const publicRoutes = new Hono();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);
const rateLimitService = new RateLimitService(redis);

// Valid sort options for task list
const VALID_SORT_BY = ['position', 'created_at', 'updated_at', 'due_date', 'priority', 'sequence_number'] as const;
const VALID_SORT_ORDER = ['asc', 'desc'] as const;

type TaskSortBy = (typeof VALID_SORT_BY)[number];
type TaskSortOrder = (typeof VALID_SORT_ORDER)[number];

function isValidSortBy(value: string): value is TaskSortBy {
  return (VALID_SORT_BY as readonly string[]).includes(value);
}

function isValidSortOrder(value: string): value is TaskSortOrder {
  return (VALID_SORT_ORDER as readonly string[]).includes(value);
}
const db = getDatabase();
const smartViewService = new SmartViewService(db);
const taskService = new TaskService(db);

// Access public share by token
publicRoutes.get('/share/:token', async (c) => {
  const token = c.req.param('token');

  // Get the public share
  const shareResult = await smartViewService.getPublicShareByToken(token);

  if (!shareResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: shareResult.error.message } }, 404);
  }

  const share = shareResult.value;

  // Check if password protected
  if (share.passwordHash) {
    return c.json({
      success: true,
      data: {
        requiresPassword: true,
        shareId: share.id,
      },
    });
  }

  // Record access
  await smartViewService.recordPublicShareAccess(token);

  // Get the smart view
  const viewResult = await smartViewService.getById(share.smartViewId);
  if (!viewResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Smart view not found' } }, 404);
  }

  const view = viewResult.value;

  // Apply display type override if set
  const displayType = share.displayTypeOverride || view.displayType;

  // Get tasks (using a system context for public access)
  const sortBy = isValidSortBy(view.sortBy) ? view.sortBy : 'position';
  const sortOrder = isValidSortOrder(view.sortOrder) ? view.sortOrder : 'asc';

  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));

  const tasksResult = await taskService.list({
    sortBy,
    sortOrder,
    page,
    limit,
  });

  if (!tasksResult.ok) {
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: tasksResult.error.message } }, 500);
  }

  // Filter out hidden fields if configured
  const tasks = tasksResult.value.tasks;
  const hideFields = Array.isArray(share.hideFields) ? share.hideFields.filter((f): f is string => typeof f === 'string') : [];

  const filteredTasks = hideFields.length > 0
    ? tasks.map((task) => {
        const taskCopy = { ...task };
        for (const field of hideFields) {
          if (field in taskCopy) {
            delete (taskCopy as Record<string, typeof taskCopy[keyof typeof taskCopy]>)[field];
          }
        }
        return taskCopy;
      })
    : tasks;

  return c.json({
    success: true,
    data: {
      view: {
        name: view.name,
        description: view.description,
        displayType,
        groupBy: view.groupBy,
        sortBy: view.sortBy,
        sortOrder: view.sortOrder,
        visibleFields: view.visibleFields,
      },
      tasks: filteredTasks,
      meta: {
        total: tasksResult.value.total,
        page: parseInt(c.req.query('page') || '1', 10),
        limit: parseInt(c.req.query('limit') || '50', 10),
      },
    },
  });
});

// Verify password for protected share
publicRoutes.post(
  '/share/:token/verify',
  zValidator('json', z.object({ password: z.string() })),
  async (c) => {
    const token = c.req.param('token');
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    const rateLimitKey = `share-pw:${ip}:${token}`;

    // Check if locked out from too many failed attempts
    const lockout = await rateLimitService.isLockedOut(rateLimitKey);
    if (lockout.lockedOut) {
      return c.json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } }, 429);
    }

    const { password } = c.req.valid('json');

    const isValid = await smartViewService.verifyPublicSharePassword(token, password);

    if (!isValid.ok || !isValid.value) {
      await rateLimitService.trackFailedAttempt(rateLimitKey);
      return c.json({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Invalid password' } }, 401);
    }

    // Clear failed attempts on success
    await rateLimitService.clearFailedAttempts(rateLimitKey);

    // Record access
    await smartViewService.recordPublicShareAccess(token);

    // Get the public share
    const shareResult = await smartViewService.getPublicShareByToken(token);
    if (!shareResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Share not found' } }, 404);
    }

    const share = shareResult.value;

    // Get the smart view
    const viewResult = await smartViewService.getById(share.smartViewId);
    if (!viewResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Smart view not found' } }, 404);
    }

    const view = viewResult.value;
    const displayType = share.displayTypeOverride || view.displayType;

    // Get tasks
    const sortBy = isValidSortBy(view.sortBy) ? view.sortBy : 'position';
    const sortOrder = isValidSortOrder(view.sortOrder) ? view.sortOrder : 'asc';

    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));

    const tasksResult = await taskService.list({
      sortBy,
      sortOrder,
      page,
      limit,
    });

    if (!tasksResult.ok) {
      return c.json({ success: false, error: { code: 'FETCH_FAILED', message: tasksResult.error.message } }, 500);
    }

    // Filter out hidden fields
    const tasks = tasksResult.value.tasks;
    const hideFields = Array.isArray(share.hideFields) ? share.hideFields.filter((f): f is string => typeof f === 'string') : [];

    const filteredTasks = hideFields.length > 0
      ? tasks.map((task) => {
          const taskCopy = { ...task };
          for (const field of hideFields) {
            if (field in taskCopy) {
              delete (taskCopy as Record<string, typeof taskCopy[keyof typeof taskCopy]>)[field];
            }
          }
          return taskCopy;
        })
      : tasks;

    return c.json({
      success: true,
      data: {
        view: {
          name: view.name,
          description: view.description,
          displayType,
          groupBy: view.groupBy,
          sortBy: view.sortBy,
          sortOrder: view.sortOrder,
          visibleFields: view.visibleFields,
        },
        tasks: filteredTasks,
        meta: {
          total: tasksResult.value.total,
          page,
          limit,
        },
      },
    });
  }
);

export { publicRoutes };
