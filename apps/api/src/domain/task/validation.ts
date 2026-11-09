/**
 * Foreign-id validation for task writes: every state, label, assignee and
 * parent id must belong to the task's project / workspace. Without this a
 * caller could attach another workspace's label or user to a task (and leak
 * that user's email through the response).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { labels, projectMembers, projects, taskStates, tasks, workspaceMembers } from '../../db/index.js';
import type { DbExecutor } from './db.js';
import { TaskError } from './errors.js';

export interface ProjectScope {
  id: string;
  workspaceId: string;
  identifier: string;
  name: string;
  access: string;
}

export async function loadProjectScope(db: DbExecutor, projectId: string): Promise<ProjectScope> {
  const [project] = await db
    .select({
      id: projects.id,
      workspaceId: projects.workspaceId,
      identifier: projects.identifier,
      name: projects.name,
      access: projects.access,
    })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) throw new TaskError('PROJECT_NOT_FOUND', 'Project not found', [projectId]);
  return project;
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** The state must belong to the project. Returns its category. */
export async function assertStateInProject(db: DbExecutor, projectId: string, stateId: string): Promise<string> {
  const [state] = await db
    .select({ id: taskStates.id, category: taskStates.category })
    .from(taskStates)
    .where(and(eq(taskStates.id, stateId), eq(taskStates.projectId, projectId)));
  if (!state) throw new TaskError('INVALID_STATE', 'State does not belong to this project', [stateId]);
  return state.category;
}

export async function assertLabelsInProject(db: DbExecutor, projectId: string, labelIds: readonly string[]): Promise<void> {
  const ids = unique(labelIds);
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.projectId, projectId), inArray(labels.id, ids)));
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new TaskError('INVALID_LABEL', 'Label does not belong to this project', missing);
  }
}

/**
 * Assignees must be workspace members and, for a restricted project, able to
 * access it: access 'admin' → owner/admin only; access 'members' → owner/admin
 * or listed in project_members.
 */
export async function assertAssigneesCanAccess(
  db: DbExecutor,
  project: ProjectScope,
  userIds: readonly string[]
): Promise<void> {
  const ids = unique(userIds);
  if (ids.length === 0) return;
  const rows = await db
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      projectMemberId: projectMembers.id,
    })
    .from(workspaceMembers)
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.userId, workspaceMembers.userId), eq(projectMembers.projectId, project.id))
    )
    .where(and(eq(workspaceMembers.workspaceId, project.workspaceId), inArray(workspaceMembers.userId, ids)));

  const allowed = new Set(
    rows
      .filter((row) => {
        const privileged = row.role === 'owner' || row.role === 'admin';
        if (project.access === 'admin') return privileged;
        if (project.access === 'members') return privileged || row.projectMemberId !== null;
        return true;
      })
      .map((row) => row.userId)
  );
  const rejected = ids.filter((id) => !allowed.has(id));
  if (rejected.length > 0) {
    throw new TaskError('INVALID_ASSIGNEE', 'Assignee is not a member with access to this project', rejected);
  }
}

/**
 * The parent must be a live task of the same project, and (for an existing
 * task) must not be the task itself or one of its descendants.
 */
export async function assertValidParent(
  db: DbExecutor,
  projectId: string,
  parentId: string,
  taskId?: string
): Promise<void> {
  if (taskId && parentId === taskId) {
    throw new TaskError('PARENT_CYCLE', 'A task cannot be its own parent', [parentId]);
  }
  const [parent] = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(and(eq(tasks.id, parentId), isNull(tasks.deletedAt)));
  if (!parent) throw new TaskError('INVALID_PARENT', 'Parent task not found', [parentId]);
  if (parent.projectId !== projectId) {
    throw new TaskError('INVALID_PARENT', 'Parent task must be in the same project', [parentId]);
  }
  if (!taskId) return;

  // Walk up from the proposed parent; reaching taskId means a cycle.
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE ancestors(id, parent_id, depth) AS (
      SELECT id, parent_id, 0 FROM tasks WHERE id = ${parentId}
      UNION ALL
      SELECT t.id, t.parent_id, a.depth + 1
      FROM tasks t JOIN ancestors a ON t.id = a.parent_id
      WHERE a.depth < 1000
    )
    SELECT id FROM ancestors WHERE id = ${taskId} LIMIT 1
  `);
  if (rows.length > 0) {
    throw new TaskError('PARENT_CYCLE', 'Parent would create a cycle', [parentId]);
  }
}
