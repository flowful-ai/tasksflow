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
import { getDatabase } from '@flowtask/database';
import { TaskService, isTaskError, resolveProjectAccess } from '@flowtask/domain';
import { getCurrentUser, hasPermission, type WorkspacePermission } from '@flowtask/auth';
import { TRASH_RETENTION_DAYS, TrashQuerySchema } from '@flowtask/shared';
import { publishEvent } from '../sse/manager.js';

const trashRoutes = new Hono();
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

// TODO(authz): replace with the central authorize() helper.
async function projectAccess(projectId: string, userId: string, permission: WorkspacePermission) {
  const access = await resolveProjectAccess(db, projectId, userId);
  if (!access) return { status: 404 as const };
  if (!hasPermission(access.role, permission)) return { status: 403 as const };
  return { status: 200 as const, access };
}

trashRoutes.get(
  '/:projectId/trash',
  zValidator('param', ProjectParamsSchema, validationHook),
  zValidator('query', TrashQuerySchema, validationHook),
  async (c) => {
    const user = getCurrentUser(c);
    const { projectId } = c.req.valid('param');
    const { page, limit } = c.req.valid('query');
    const check = await projectAccess(projectId, user.id, 'task:read');
    if (check.status === 404) return fail(c, 404, 'NOT_FOUND', 'Project not found');
    if (check.status === 403) return fail(c, 403, 'FORBIDDEN', 'Not authorized');

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
    const user = getCurrentUser(c);
    const { projectId, taskId } = c.req.valid('param');
    const check = await projectAccess(projectId, user.id, 'task:update');
    if (check.status === 404) return fail(c, 404, 'NOT_FOUND', 'Project not found');
    if (check.status === 403) return fail(c, 403, 'FORBIDDEN', 'Not authorized');

    const existing = await taskService.getById(taskId, { includeDeleted: true });
    if (!existing.ok || existing.value.projectId !== projectId) return fail(c, 404, 'NOT_FOUND', 'Task not found');

    const result = await taskService.restore(taskId, user.id);
    if (!result.ok) {
      if (isTaskError(result.error)) return fail(c, result.error.status, result.error.code, result.error.message);
      console.error('[trash]', result.error);
      return fail(c, 500, 'RESTORE_FAILED', 'Failed to restore task');
    }
    // Same realtime event as the legacy POST /api/tasks/:id/restore.
    publishEvent(check.access.workspaceId, 'task:created', result.value);
    return c.json({ success: true, data: result.value });
  }
);

export { trashRoutes };
