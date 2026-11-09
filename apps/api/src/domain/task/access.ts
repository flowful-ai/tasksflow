/**
 * Project access for domain services that act on behalf of OTHER users
 * (e.g. deciding which mentioned users may be notified). Request-level
 * authorization lives in AuthorizationService (workspace/authorization.ts);
 * the ACL rule itself is shared: projectAclAllows.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { projectMembers, projects, workspaceMembers } from '../../db/index.js';
import type { WorkspaceRole } from '@flowtask/shared';
import { projectAclAllows } from '../workspace/authorization.js';
import type { DbExecutor } from './db.js';

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

/** Users (of a candidate list) that are workspace members allowed into the project. */
export async function filterUsersWithProjectAccess(
  db: DbExecutor,
  projectId: string,
  userIds: readonly string[]
): Promise<string[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      access: projects.access,
      projectMemberId: projectMembers.id,
    })
    .from(projects)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, projects.workspaceId))
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, workspaceMembers.userId))
    )
    .where(and(eq(projects.id, projectId), inArray(workspaceMembers.userId, ids)));
  return rows
    .filter((r) => isWorkspaceRole(r.role) && projectAclAllows(r.access, r.role, r.projectMemberId !== null))
    .map((r) => r.userId);
}
