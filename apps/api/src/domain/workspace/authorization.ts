import { and, eq, gt, inArray, or } from 'drizzle-orm';
import type { Database, Project, Task } from '../../db/index.js';
import {
  projects,
  projectMembers,
  tasks,
  workspaceMembers,
  taskStates,
  labels,
  sessions,
} from '../../db/index.js';
import type { WorkspaceRole } from '@flowtask/shared';
import { isAdminRole, isWorkspaceRole } from './role-policy.js';

/**
 * Central authorization for workspace, project and task access.
 *
 * Every check resolves the resource up to its workspace, verifies membership,
 * applies the project-level ACL (`projects.access` + `project_members`) and
 * finally the role permission. Results are discriminated unions carrying the
 * loaded entities and the caller's role, so callers never need non-null
 * assertions on the project or task.
 *
 * Denials distinguish `not_found` (the resource does not exist, or the caller
 * may not know it exists: other workspace, restricted project) from
 * `forbidden` (the caller can see it but lacks the role permission).
 */

export type PermissionChecker<P extends string> = (role: WorkspaceRole, permission: P) => boolean;

export type AuthzDenial = {
  ok: false;
  reason: 'not_found' | 'forbidden';
  message: string;
};

export type WorkspaceGrant = {
  ok: true;
  workspaceId: string;
  role: WorkspaceRole;
};

export type ProjectGrant = WorkspaceGrant & {
  project: Project;
};

export type TaskGrant = ProjectGrant & {
  task: Task;
};

export type AuthzResult<G> = G | AuthzDenial;

export interface TaskAuthorizationOptions {
  /** Allow soft-deleted tasks (restore, trash views). Defaults to false. */
  includeDeleted?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function notFound(what: string): AuthzDenial {
  return { ok: false, reason: 'not_found', message: `${what} not found` };
}

function forbidden(message = 'Insufficient permissions'): AuthzDenial {
  return { ok: false, reason: 'forbidden', message };
}

/** Pure project ACL decision, given the project's member list membership. */
export function projectAclAllows(
  access: string,
  role: WorkspaceRole,
  isProjectMember: boolean
): boolean {
  if (isAdminRole(role)) return true;
  if (access === 'all') return true;
  if (access === 'members') return isProjectMember;
  // 'admin' (admin-only) and any unknown value deny members.
  return false;
}

export class AuthorizationService<P extends string> {
  constructor(
    private readonly db: Database,
    private readonly can: PermissionChecker<P>
  ) {}

  hasPermission(role: WorkspaceRole, permission: P): boolean {
    return this.can(role, permission);
  }

  /** The caller's role in a workspace, or null when not a member. */
  async getRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    if (!isUuid(workspaceId) || !isUuid(userId)) return null;
    const [member] = await this.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))
      );
    return member && isWorkspaceRole(member.role) ? member.role : null;
  }

  async authorizeWorkspace(
    workspaceId: string,
    userId: string,
    permission: P
  ): Promise<AuthzResult<WorkspaceGrant>> {
    const role = await this.getRole(workspaceId, userId);
    if (!role) {
      return forbidden('Not a workspace member');
    }
    if (!this.can(role, permission)) {
      return forbidden();
    }
    return { ok: true, workspaceId, role };
  }

  async authorizeProject(
    projectId: string,
    userId: string,
    permission: P
  ): Promise<AuthzResult<ProjectGrant>> {
    if (!isUuid(projectId)) return notFound('Project');
    const [project] = await this.db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return notFound('Project');
    return this.authorizeLoadedProject(project, userId, permission);
  }

  async authorizeTask(
    taskId: string,
    userId: string,
    permission: P,
    options: TaskAuthorizationOptions = {}
  ): Promise<AuthzResult<TaskGrant>> {
    if (!isUuid(taskId)) return notFound('Task');
    const [row] = await this.db
      .select({ task: tasks, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(eq(tasks.id, taskId));

    if (!row || (row.task.deletedAt && !options.includeDeleted)) {
      return notFound('Task');
    }

    const grant = await this.authorizeLoadedProject(row.project, userId, permission, 'Task');
    if (!grant.ok) return grant;
    return { ...grant, task: row.task };
  }

  /** Project ACL check for a user whose role is already known. */
  async canAccessProject(
    project: Pick<Project, 'id' | 'access'>,
    userId: string,
    role: WorkspaceRole
  ): Promise<boolean> {
    if (projectAclAllows(project.access, role, false)) return true;
    if (project.access !== 'members') return false;
    return this.isProjectMember(project.id, userId);
  }

  /**
   * Whether an arbitrary user (not necessarily the caller) is a workspace
   * member who can access the project. Used to validate assignees.
   */
  async userCanAccessProject(
    project: Pick<Project, 'id' | 'access' | 'workspaceId'>,
    userId: string
  ): Promise<boolean> {
    const role = await this.getRole(project.workspaceId, userId);
    if (!role) return false;
    return this.canAccessProject(project, userId, role);
  }

  /**
   * Ids of the projects in the workspace the user may see. Archived projects
   * are included unless `excludeArchived` is set.
   */
  async listAccessibleProjectIds(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    options: { excludeArchived?: boolean } = {}
  ): Promise<string[]> {
    if (!isUuid(workspaceId)) return [];
    const inWorkspace = options.excludeArchived
      ? and(eq(projects.workspaceId, workspaceId), eq(projects.isArchived, false))
      : eq(projects.workspaceId, workspaceId);

    if (isAdminRole(role)) {
      const rows = await this.db.select({ id: projects.id }).from(projects).where(inWorkspace);
      return rows.map((r) => r.id);
    }

    const rows = await this.db
      .selectDistinct({ id: projects.id })
      .from(projects)
      .leftJoin(
        projectMembers,
        and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId))
      )
      .where(
        and(
          inWorkspace,
          or(
            eq(projects.access, 'all'),
            and(eq(projects.access, 'members'), eq(projectMembers.userId, userId))
          )
        )
      );
    return rows.map((r) => r.id);
  }

  /** Restrict candidate project ids to those the user may access. */
  async filterAccessibleProjectIds(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    candidateIds: readonly string[]
  ): Promise<string[]> {
    const accessible = new Set(await this.listAccessibleProjectIds(workspaceId, userId, role));
    return candidateIds.filter((id) => accessible.has(id));
  }

  async stateBelongsToProject(stateId: string, projectId: string): Promise<boolean> {
    if (!isUuid(stateId)) return false;
    const [state] = await this.db
      .select({ id: taskStates.id })
      .from(taskStates)
      .where(and(eq(taskStates.id, stateId), eq(taskStates.projectId, projectId)));
    return Boolean(state);
  }

  async labelsBelongToProject(labelIds: readonly string[], projectId: string): Promise<boolean> {
    const unique = [...new Set(labelIds)];
    if (unique.length === 0) return true;
    if (!unique.every((id) => isUuid(id))) return false;
    const rows = await this.db
      .select({ id: labels.id })
      .from(labels)
      .where(and(inArray(labels.id, unique), eq(labels.projectId, projectId)));
    return rows.length === unique.length;
  }

  /** Users (out of `userIds`) who are workspace members able to access the project. */
  async usersCanAccessProject(
    project: Pick<Project, 'id' | 'access' | 'workspaceId'>,
    userIds: readonly string[]
  ): Promise<boolean> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return true;
    if (!unique.every((id) => isUuid(id))) return false;
    const results = await Promise.all(unique.map((id) => this.userCanAccessProject(project, id)));
    return results.every(Boolean);
  }

  /** Whether all `userIds` are members of the workspace. */
  async areWorkspaceMembers(workspaceId: string, userIds: readonly string[]): Promise<boolean> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return true;
    if (!unique.every((id) => isUuid(id))) return false;
    const rows = await this.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.userId, unique))
      );
    return rows.length === unique.length;
  }

  /** Project of a task (deleted tasks included), or null. */
  async getTaskProjectId(taskId: string): Promise<string | null> {
    if (!isUuid(taskId)) return null;
    const [row] = await this.db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, taskId));
    return row?.projectId ?? null;
  }

  /** Whether a Better Auth session still exists and has not expired. */
  async isSessionActive(sessionId: string): Promise<boolean> {
    if (!isUuid(sessionId)) return false;
    const [row] = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())));
    return Boolean(row);
  }

  private async isProjectMember(projectId: string, userId: string): Promise<boolean> {
    if (!isUuid(userId)) return false;
    const [member] = await this.db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    return Boolean(member);
  }

  private async authorizeLoadedProject(
    project: Project,
    userId: string,
    permission: P,
    what = 'Project'
  ): Promise<AuthzResult<ProjectGrant>> {
    const role = await this.getRole(project.workspaceId, userId);
    if (!role) return notFound(what);
    if (!(await this.canAccessProject(project, userId, role))) return notFound(what);
    if (!this.can(role, permission)) return forbidden();
    return { ok: true, workspaceId: project.workspaceId, role, project };
  }
}
