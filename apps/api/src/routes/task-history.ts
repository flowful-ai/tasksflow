/**
 * Per-task activity timeline. Mounted at /api/tasks (before the tasks router).
 *
 *   GET /:taskId/history?cursor=&limit=   → TaskHistoryItem[] (newest first), meta.nextCursor
 *
 * Works for soft-deleted tasks too (so the trash can show what happened).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '../db/index.js';
import { TaskHistoryService } from '../domain/index.js';
import { requireTask } from '../lib/authorize.js';
import { fromResult, handleRouteError, validationHook } from '../lib/responses.js';
import { TaskHistoryQuerySchema } from '@flowtask/shared';

const taskHistoryRoutes = new Hono();
taskHistoryRoutes.onError(handleRouteError);
const db = getDatabase();
const historyService = new TaskHistoryService(db);

const ParamsSchema = z.object({ taskId: z.string().uuid() });

taskHistoryRoutes.get(
  '/:taskId/history',
  zValidator('param', ParamsSchema, validationHook),
  zValidator('query', TaskHistoryQuerySchema, validationHook),
  async (c) => {
    const { taskId } = c.req.valid('param');
    const { cursor, limit } = c.req.valid('query');
    await requireTask(c, taskId, 'task:read', { includeDeleted: true });

    const page = fromResult(await historyService.list(taskId, { cursor, limit }), {
      code: 'HISTORY_FAILED',
      message: 'Failed to load history',
    });
    return c.json({
      success: true,
      data: page.items,
      meta: { nextCursor: page.nextCursor },
    });
  }
);

export { taskHistoryRoutes };
