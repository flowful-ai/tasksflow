import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getDatabase } from '../db/index.js';
import { ProjectService, WorkspaceService } from '../domain/index.js';
import { hasPermission, type WorkspacePermission } from '../auth/index.js';

const db = getDatabase();
const projectService = new ProjectService(db);
const workspaceService = new WorkspaceService(db);

export interface IntegrationAccessGranted {
  ok: true;
  projectId: string;
  workspaceId: string;
}

export interface IntegrationAccessDenied {
  ok: false;
  status: 403 | 404;
  code: 'NOT_FOUND' | 'FORBIDDEN';
  message: string;
}

/**
 * Authorize a user for a project-scoped integration action: workspace
 * membership, the role permission, and the project ACL.
 *
 * Reads use `project:read`; installing, linking, syncing and configuring use
 * `project:manage_integrations` (owner/admin).
 */
export async function authorizeProjectIntegration(
  projectId: string,
  userId: string,
  permission: WorkspacePermission
): Promise<IntegrationAccessGranted | IntegrationAccessDenied> {
  const projectResult = await projectService.getById(projectId);
  if (!projectResult.ok) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Project not found' };
  }
  const workspaceId = projectResult.value.workspaceId;

  const roleResult = await workspaceService.getMemberRole(workspaceId, userId);
  if (!roleResult.ok || !roleResult.value) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Access denied' };
  }
  const role = roleResult.value;

  if (!(await projectService.hasAccess(projectId, userId, role))) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Access denied' };
  }
  if (!hasPermission(role, permission)) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Insufficient permissions' };
  }
  return { ok: true, projectId, workspaceId };
}

/** Uniform `{ success: false, error: { code, message } }` response. */
export function apiError(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ success: false, error: { code, message } }, status);
}
