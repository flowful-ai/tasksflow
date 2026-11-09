/**
 * Per-task activity timeline. Mounted at /api/tasks (before the tasks router).
 *
 *   GET /:taskId/history?cursor=&limit=   → TaskHistoryItem[] (newest first), meta.nextCursor
 *
 * Works for soft-deleted tasks too (so the trash can show what happened).
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '../db/index.js';
import { TaskHistoryService } from '../domain/index.js';
import { requireTask } from '../lib/authorize.js';
import { handleRouteError } from '../lib/responses.js';
import { TaskHistoryQuerySchema } from '@flowtask/shared';

const taskHistoryRoutes = new Hono();
taskHistoryRoutes.onError(handleRouteError);
const db = getDatabase();
const historyService = new TaskHistoryService(db);

const ParamsSchema = z.object({ taskId: z.string().uuid() });

function fail(c: Context, status: 400 | 500, code: string, message: string) {
  return c.json({ success: false, error: { code, message } }, status);
}

const validationHook = (result: { success: boolean; error?: z.ZodError }, c: Context) => {
  if (!result.success) {
    return fail(c, 400, 'VALIDATION_ERROR', result.error?.issues[0]?.message ?? 'Invalid request');
  }
};

taskHistoryRoutes.get(
  '/:taskId/history',
  zValidator('param', ParamsSchema, validationHook),
  zValidator('query', TaskHistoryQuerySchema, validationHook),
  async (c) => {
    const { taskId } = c.req.valid('param');
    const { cursor, limit } = c.req.valid('query');
    await requireTask(c, taskId, 'task:read', { includeDeleted: true });

    const result = await historyService.list(taskId, { cursor, limit });
    if (!result.ok) {
      console.error('[task-history]', result.error);
      return fail(c, 500, 'HISTORY_FAILED', 'Failed to load history');
    }
    return c.json({ success: true, data: result.value.items, meta: { nextCursor: result.value.nextCursor } });
  }
);

export { taskHistoryRoutes };
