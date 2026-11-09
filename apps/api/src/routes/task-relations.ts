/**
 * Task relations (blocks / relates / duplicates). Mounted at /api/tasks
 * BEFORE the tasks router (paths are /:taskId/relations…, which never collide
 * with the tasks router's single-segment /:taskId routes).
 *
 *   GET    /:taskId/relations                  → TaskRelationView[]
 *   POST   /:taskId/relations                  { relatedTaskId, type, direction? } → 201 TaskRelationView
 *   DELETE /:taskId/relations/:relationId      → null
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '@flowtask/database';
import { TaskRelationService, isTaskError, resolveTaskAccess } from '@flowtask/domain';
import { getCurrentUser, hasPermission, type WorkspacePermission } from '@flowtask/auth';
import { AddTaskRelationSchema } from '@flowtask/shared';

const taskRelationRoutes = new Hono();
const db = getDatabase();
const relationService = new TaskRelationService(db);

const ParamsSchema = z.object({ taskId: z.string().uuid() });
const RelationParamsSchema = z.object({ taskId: z.string().uuid(), relationId: z.string().uuid() });

function fail(c: Context, status: 400 | 403 | 404 | 409 | 500, code: string, message: string) {
  return c.json({ success: false, error: { code, message } }, status);
}

function failFromError(c: Context, error: Error) {
  if (isTaskError(error)) return fail(c, error.status, error.code, error.message);
  console.error('[task-relations]', error);
  return fail(c, 500, 'INTERNAL_ERROR', 'Request failed');
}

// TODO(authz): replace with the central authorize() helper.
async function canOnTask(taskId: string, userId: string, permission: WorkspacePermission): Promise<boolean | null> {
  const access = await resolveTaskAccess(db, taskId, userId);
  if (!access) return null;
  return hasPermission(access.role, permission);
}

const validationHook = (result: { success: boolean; error?: z.ZodError }, c: Context) => {
  if (!result.success) {
    return fail(c, 400, 'VALIDATION_ERROR', result.error?.issues[0]?.message ?? 'Invalid request');
  }
};

taskRelationRoutes.get('/:taskId/relations', zValidator('param', ParamsSchema, validationHook), async (c) => {
  const user = getCurrentUser(c);
  const { taskId } = c.req.valid('param');
  const allowed = await canOnTask(taskId, user.id, 'task:read');
  if (allowed === null) return fail(c, 404, 'NOT_FOUND', 'Task not found');
  if (!allowed) return fail(c, 403, 'FORBIDDEN', 'Not authorized');

  const result = await relationService.list(taskId);
  if (!result.ok) return failFromError(c, result.error);
  // Hide relations to tasks the user cannot see (restricted projects).
  const visible = [];
  for (const view of result.value) {
    if (await resolveTaskAccess(db, view.task.id, user.id)) visible.push(view);
  }
  return c.json({ success: true, data: visible });
});

taskRelationRoutes.post(
  '/:taskId/relations',
  zValidator('param', ParamsSchema, validationHook),
  zValidator('json', AddTaskRelationSchema, validationHook),
  async (c) => {
    const user = getCurrentUser(c);
    const { taskId } = c.req.valid('param');
    const body = c.req.valid('json');

    const [own, other] = await Promise.all([
      canOnTask(taskId, user.id, 'task:update'),
      canOnTask(body.relatedTaskId, user.id, 'task:update'),
    ]);
    if (own === null || other === null) return fail(c, 404, 'NOT_FOUND', 'Task not found');
    if (!own || !other) return fail(c, 403, 'FORBIDDEN', 'Not authorized');

    const result = await relationService.add({
      taskId,
      relatedTaskId: body.relatedTaskId,
      type: body.type,
      direction: body.direction,
      createdBy: user.id,
    });
    if (!result.ok) return failFromError(c, result.error);
    return c.json({ success: true, data: result.value }, 201);
  }
);

taskRelationRoutes.delete(
  '/:taskId/relations/:relationId',
  zValidator('param', RelationParamsSchema, validationHook),
  async (c) => {
    const user = getCurrentUser(c);
    const { taskId, relationId } = c.req.valid('param');
    const allowed = await canOnTask(taskId, user.id, 'task:update');
    if (allowed === null) return fail(c, 404, 'NOT_FOUND', 'Task not found');
    if (!allowed) return fail(c, 403, 'FORBIDDEN', 'Not authorized');

    const result = await relationService.remove(taskId, relationId, user.id);
    if (!result.ok) return failFromError(c, result.error);
    return c.json({ success: true, data: null });
  }
);

export { taskRelationRoutes };
