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
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '../db/index.js';
import { TaskBulkService, lookupTaskProjects } from '../domain/index.js';
import type { WorkspacePermission } from '../auth/index.js';
import { getAuthz, requireUser } from '../lib/authorize.js';
import { badRequest, fromResult, validationHook, handleRouteError } from '../lib/responses.js';
import { BulkTaskRequestSchema, type BulkTaskOperation } from '@flowtask/shared';

const taskBulkRoutes = new Hono();
taskBulkRoutes.onError(handleRouteError);
const db = getDatabase();
const bulkService = new TaskBulkService(db);

/** Permissions needed to apply an op (same mapping as the single-task routes). */
export function requiredBulkPermissions(op: BulkTaskOperation): WorkspacePermission[] {
  const perms = new Set<WorkspacePermission>();
  if (op.delete) perms.add('task:delete');
  if (op.restore || op.stateId !== undefined || op.priority !== undefined) perms.add('task:update');
  if (op.addLabelIds?.length || op.removeLabelIds?.length) perms.add('task:update');
  if (op.addAssigneeIds?.length || op.removeAssigneeIds?.length) perms.add('task:assign');
  return [...perms];
}

taskBulkRoutes.post(
  '/bulk',
  zValidator('json', BulkTaskRequestSchema, validationHook),
  async (c) => {
    const user = requireUser(c);
    const { taskIds, op } = c.req.valid('json');

    const located = await lookupTaskProjects(db, taskIds);
    const workspaceIds = new Set([...located.values()].map((v) => v.workspaceId));
    if (workspaceIds.size > 1) {
      throw badRequest('All tasks must belong to one workspace', 'MIXED_WORKSPACES');
    }

    // One role lookup and one ACL query for the whole request.
    const allowedProjectIds = new Set<string>();
    const [workspaceId] = workspaceIds;
    if (workspaceId) {
      const authz = getAuthz();
      const role = await authz.getRole(workspaceId, user.id);
      const needed: WorkspacePermission[] = ['task:read', ...requiredBulkPermissions(op)];
      if (role && needed.every((p) => authz.hasPermission(role, p))) {
        const candidates = [...new Set([...located.values()].map((v) => v.projectId))];
        for (const id of await authz.filterAccessibleProjectIds(
          workspaceId,
          user.id,
          role,
          candidates
        )) {
          allowedProjectIds.add(id);
        }
      }
    }

    // Realtime, Slack and GitHub sync run off the domain events TaskBulkService emits.
    const { results, tasks } = fromResult(
      await bulkService.apply({ taskIds, op, actorId: user.id, allowedProjectIds }),
      { code: 'BULK_FAILED', message: 'Bulk operation failed' }
    );
    return c.json({ success: true, data: { results, tasks } });
  }
);

export { taskBulkRoutes };
