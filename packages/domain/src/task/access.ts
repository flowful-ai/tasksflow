/**
 * Project/task access resolution used by workstream-B routes (search,
 * relations, history, trash, bulk, notifications).
 *
 * TODO(consolidate): this mirrors the route-level checkTaskAccess helpers and
 * should be replaced by the central authorize() helper once it lands.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@flowtask/database';
import { projectMembers, projects, tasks, workspaceMembers } from '@flowtask/database';
import type { WorkspaceRole } from '@flowtask/shared';
import type { DbExecutor } from './db.js';

export interface ProjectAccess {
  projectId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

/** Pure ACL rule (same as ProjectService.hasAccess). */
export function canAccessProject(access: string, role: WorkspaceRole, isProjectMember: boolean): boolean {
  if (role === 'owner' || role === 'admin') return true;
  if (access === 'all') return true;
  if (access === 'admin') return false;
  return isProjectMember;
}

/** Workspace role of a user, or null when not a member. */
export async function getWorkspaceRole(db: DbExecutor, workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return row && isWorkspaceRole(row.role) ? row.role : null;
}

/** The user's access to a project (workspace role + project ACL), or null. */
export async function resolveProjectAccess(db: DbExecutor, projectId: string, userId: string): Promise<ProjectAccess | null> {
  const [row] = await db
    .select({
      projectId: projects.id,
      workspaceId: projects.workspaceId,
      access: projects.access,
      role: workspaceMembers.role,
      projectMemberId: projectMembers.id,
    })
    .from(projects)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, projects.workspaceId), eq(workspaceMembers.userId, userId))
    )
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))
    .where(eq(projects.id, projectId));
  if (!row || !isWorkspaceRole(row.role)) return null;
  if (!canAccessProject(row.access, row.role, row.projectMemberId !== null)) return null;
  return { projectId: row.projectId, workspaceId: row.workspaceId, role: row.role };
}

/** Access to the project of a task. Soft-deleted tasks only with includeDeleted. */
export async function resolveTaskAccess(
  db: DbExecutor,
  taskId: string,
  userId: string,
  opts: { includeDeleted?: boolean } = {}
): Promise<(ProjectAccess & { taskId: string }) | null> {
  const conditions = [eq(tasks.id, taskId)];
  if (!opts.includeDeleted) conditions.push(isNull(tasks.deletedAt));
  const [task] = await db.select({ projectId: tasks.projectId }).from(tasks).where(and(...conditions));
  if (!task) return null;
  const access = await resolveProjectAccess(db, task.projectId, userId);
  return access ? { ...access, taskId } : null;
}

/** Ids of the projects in a workspace the user can access (non-archived included). */
export async function listAccessibleProjectIds(db: Database | DbExecutor, workspaceId: string, userId: string): Promise<string[]> {
  const role = await getWorkspaceRole(db, workspaceId, userId);
  if (!role) return [];
  const rows = await db
    .select({ id: projects.id, access: projects.access, projectMemberId: projectMembers.id })
    .from(projects)
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))
    .where(eq(projects.workspaceId, workspaceId));
  return rows.filter((r) => canAccessProject(r.access, role, r.projectMemberId !== null)).map((r) => r.id);
}

/** Users (of a candidate list) that can access a project. */
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
    .filter((r) => isWorkspaceRole(r.role) && canAccessProject(r.access, r.role, r.projectMemberId !== null))
    .map((r) => r.userId);
}
