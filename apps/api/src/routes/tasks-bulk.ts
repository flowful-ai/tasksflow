/**
 * Bulk task operations. Mounted at /api/tasks BEFORE the tasks router so
 * POST /api/tasks/bulk is never captured by a /:taskId route.
 *
 *   POST /bulk  { taskIds: uuid[1..200], op: BulkTaskOperation }
 *     → { results: BulkTaskItemResult[], tasks: TaskWithRelations[] }
 *
 * One transaction; each task is access-checked (workspace role permission +
 * project ACL) and validated on its own, and reported as updated / unchanged
 * / not_found / forbidden / invalid. All tasks must be in one workspace.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '@flowtask/database';
import { TaskBulkService, lookupTaskProjects, resolveProjectAccess } from '@flowtask/domain';
import { getCurrentUser, hasPermission, type WorkspacePermission } from '@flowtask/auth';
import { BulkTaskRequestSchema, type BulkTaskOperation } from '@flowtask/shared';

const taskBulkRoutes = new Hono();
const db = getDatabase();
const bulkService = new TaskBulkService(db);

function fail(c: Context, status: 400 | 403 | 500, code: string, message: string) {
  return c.json({ success: false, error: { code, message } }, status);
}

const validationHook = (result: { success: boolean; error?: z.ZodError }, c: Context) => {
  if (!result.success) {
    return fail(c, 400, 'VALIDATION_ERROR', result.error?.issues[0]?.message ?? 'Invalid request');
  }
};

/** Permissions needed to apply an op (same mapping as the single-task routes). */
export function requiredBulkPermissions(op: BulkTaskOperation): WorkspacePermission[] {
  const perms = new Set<WorkspacePermission>();
  if (op.delete) perms.add('task:delete');
  if (op.restore || op.stateId !== undefined || op.priority !== undefined) perms.add('task:update');
  if (op.addLabelIds?.length || op.removeLabelIds?.length) perms.add('task:update');
  if (op.addAssigneeIds?.length || op.removeAssigneeIds?.length) perms.add('task:assign');
  return [...perms];
}

taskBulkRoutes.post('/bulk', zValidator('json', BulkTaskRequestSchema, validationHook), async (c) => {
  const user = getCurrentUser(c);
  const { taskIds, op } = c.req.valid('json');

  const located = await lookupTaskProjects(db, taskIds);
  const workspaceIds = new Set([...located.values()].map((v) => v.workspaceId));
  if (workspaceIds.size > 1) return fail(c, 400, 'MIXED_WORKSPACES', 'All tasks must belong to one workspace');

  // TODO(authz): replace with the central authorize() helper.
  const needed = requiredBulkPermissions(op);
  const allowedProjectIds = new Set<string>();
  for (const projectId of new Set([...located.values()].map((v) => v.projectId))) {
    const access = await resolveProjectAccess(db, projectId, user.id);
    if (access && needed.every((p) => hasPermission(access.role, p))) allowedProjectIds.add(projectId);
  }

  const result = await bulkService.apply({ taskIds, op, actorId: user.id, allowedProjectIds });
  if (!result.ok) {
    console.error('[tasks-bulk]', result.error);
    return fail(c, 500, 'BULK_FAILED', 'Bulk operation failed');
  }

  // Realtime, Slack and GitHub sync run off the domain events TaskBulkService emits.
  const { results, tasks } = result.value;
  return c.json({ success: true, data: { results, tasks } });
});

export { taskBulkRoutes };
