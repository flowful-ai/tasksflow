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
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '../db/index.js';
import { TaskService } from '../domain/index.js';
import { requireProject } from '../lib/authorize.js';
import { fromResult, handleRouteError, notFound, validationHook } from '../lib/responses.js';
import { TRASH_RETENTION_DAYS, TrashQuerySchema } from '@flowtask/shared';

const trashRoutes = new Hono();
trashRoutes.onError(handleRouteError);
const db = getDatabase();
const taskService = new TaskService(db);

const ProjectParamsSchema = z.object({ projectId: z.string().uuid() });
const RestoreParamsSchema = z.object({ projectId: z.string().uuid(), taskId: z.string().uuid() });

trashRoutes.get(
  '/:projectId/trash',
  zValidator('param', ProjectParamsSchema, validationHook),
  zValidator('query', TrashQuerySchema, validationHook),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const { page, limit } = c.req.valid('query');
    await requireProject(c, projectId, 'task:read');

    const trash = fromResult(await taskService.listTrash(projectId, { page, limit }), {
      code: 'TRASH_FAILED',
      message: 'Failed to load trash',
    });
    return c.json({
      success: true,
      data: trash.tasks,
      meta: { total: trash.total, page, limit, retentionDays: TRASH_RETENTION_DAYS },
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
    if (!existing.ok || existing.value.projectId !== projectId) throw notFound('Task');

    const restored = fromResult(await taskService.restore(taskId, user.id), {
      code: 'RESTORE_FAILED',
      message: 'Failed to restore task',
    });
    return c.json({ success: true, data: restored });
  }
);

export { trashRoutes };
