/**
 * Project trash (soft-deleted tasks). Mounted at /api/projects (before the
 * projects router).
 *
 *   GET  /:projectId/trash?page=&limit=          → TaskWithRelations[] newest deletion first, meta {total,page,limit,retentionDays}
 *   POST /:projectId/trash/:taskId/restore       → restored TaskDetail
 *
 * Tasks stay in the trash for TRASH_RETENTION_DAYS, then the purge job
 * hard-deletes them.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '../db/index.js';
import { TaskService, isTaskError } from '../domain/index.js';
import { requireProject } from '../lib/authorize.js';
import { handleRouteError } from '../lib/responses.js';
import { TRASH_RETENTION_DAYS, TrashQuerySchema } from '@flowtask/shared';

const trashRoutes = new Hono();
trashRoutes.onError(handleRouteError);
const db = getDatabase();
const taskService = new TaskService(db);

const ProjectParamsSchema = z.object({ projectId: z.string().uuid() });
const RestoreParamsSchema = z.object({ projectId: z.string().uuid(), taskId: z.string().uuid() });

function fail(c: Context, status: 400 | 403 | 404 | 409 | 500, code: string, message: string) {
  return c.json({ success: false, error: { code, message } }, status);
}

const validationHook = (result: { success: boolean; error?: z.ZodError }, c: Context) => {
  if (!result.success) {
    return fail(c, 400, 'VALIDATION_ERROR', result.error?.issues[0]?.message ?? 'Invalid request');
  }
};

trashRoutes.get(
  '/:projectId/trash',
  zValidator('param', ProjectParamsSchema, validationHook),
  zValidator('query', TrashQuerySchema, validationHook),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const { page, limit } = c.req.valid('query');
    await requireProject(c, projectId, 'task:read');

    const result = await taskService.listTrash(projectId, { page, limit });
    if (!result.ok) {
      console.error('[trash]', result.error);
      return fail(c, 500, 'TRASH_FAILED', 'Failed to load trash');
    }
    return c.json({
      success: true,
      data: result.value.tasks,
      meta: { total: result.value.total, page, limit, retentionDays: TRASH_RETENTION_DAYS },
    });
  }
);

trashRoutes.post(
  '/:projectId/trash/:taskId/restore',
  zValidator('param', RestoreParamsSchema, validationHook),
  async (c) => {
    const { projectId, taskId } = c.req.valid('param');
    const { user } = await requireProject(c, projectId, 'task:update');

    const existing = await taskService.getById(taskId, { includeDeleted: true });
    if (!existing.ok || existing.value.projectId !== projectId) return fail(c, 404, 'NOT_FOUND', 'Task not found');

    const result = await taskService.restore(taskId, user.id);
    if (!result.ok) {
      if (isTaskError(result.error)) return fail(c, result.error.status, result.error.code, result.error.message);
      console.error('[trash]', result.error);
      return fail(c, 500, 'RESTORE_FAILED', 'Failed to restore task');
    }
    return c.json({ success: true, data: result.value });
  }
);

export { trashRoutes };
