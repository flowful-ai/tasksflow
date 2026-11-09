/**
 * Read-side helpers shared by TaskService, the relation/history/bulk services
 * and search: column projections, hydration of relations, task refs.
 */
import { and, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm';
import {
  externalLinks,
  labels,
  projects,
  taskAssignees,
  taskLabels,
  taskStates,
  tasks,
  users,
  workspaceAgents,
  type Label,
  type TaskState,
  type User,
} from '../../db/index.js';
import { formatTaskKey } from '@flowtask/shared';
import type { DbExecutor } from './db.js';
import type { TaskExternalLink, TaskRef, TaskRow, TaskWithRelations } from './types.js';

const { searchVector: _searchVector, ...taskSelectColumns } = getTableColumns(tasks);

/** Every tasks column except the generated search_vector. */
export const taskColumns = taskSelectColumns;

export const projectSummaryColumns = {
  id: projects.id,
  identifier: projects.identifier,
  name: projects.name,
  workspaceId: projects.workspaceId,
};

export const agentSummaryColumns = {
  id: workspaceAgents.id,
  name: workspaceAgents.name,
};

/** The select shape used by list/getById. */
export const taskRowSelection = {
  task: taskColumns,
  state: taskStates,
  project: projectSummaryColumns,
  agent: agentSummaryColumns,
};

export type TaskRowWithJoins = {
  task: TaskRow & { parentId: string | null };
  state: TaskState | null;
  project: { id: string; identifier: string; name: string; workspaceId: string };
  agent: { id: string; name: string } | null;
};

function isExternalType(value: string): value is TaskExternalLink['externalType'] {
  return value === 'github_issue' || value === 'github_pr';
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** Load assignees, labels, external links and sub-task counts for task rows. */
export async function hydrateTasks(
  db: DbExecutor,
  rows: readonly TaskRowWithJoins[]
): Promise<TaskWithRelations[]> {
  const ids = rows.map((r) => r.task.id);
  if (ids.length === 0) return [];

  const [assigneeRows, labelRows, linkRows, subtaskRows] = await Promise.all([
    db
      .select({ taskId: taskAssignees.taskId, user: users })
      .from(taskAssignees)
      .innerJoin(users, eq(taskAssignees.userId, users.id))
      .where(inArray(taskAssignees.taskId, ids)),
    db
      .select({ taskId: taskLabels.taskId, label: labels })
      .from(taskLabels)
      .innerJoin(labels, eq(taskLabels.labelId, labels.id))
      .where(inArray(taskLabels.taskId, ids)),
    db.select().from(externalLinks).where(inArray(externalLinks.taskId, ids)),
    db
      .select({
        parentId: tasks.parentId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`(count(*) FILTER (WHERE ${taskStates.category} = 'done'))::int`,
      })
      .from(tasks)
      .leftJoin(taskStates, eq(tasks.stateId, taskStates.id))
      .where(and(inArray(tasks.parentId, ids), isNull(tasks.deletedAt)))
      .groupBy(tasks.parentId),
  ]);

  const assignees = groupBy(assigneeRows, (r) => r.taskId);
  const taskLabelMap = groupBy(labelRows, (r) => r.taskId);
  const links = groupBy(linkRows, (r) => r.taskId);
  const subtasks = new Map<string, { total: number; done: number }>();
  for (const row of subtaskRows) {
    if (row.parentId)
      subtasks.set(row.parentId, { total: Number(row.total), done: Number(row.done) });
  }

  return rows.map((row): TaskWithRelations => {
    const counts = subtasks.get(row.task.id);
    const users: User[] = (assignees.get(row.task.id) ?? []).map((r) => r.user);
    const taskLabelsList: Label[] = (taskLabelMap.get(row.task.id) ?? []).map((r) => r.label);
    return {
      ...row.task,
      key: formatTaskKey(row.project.identifier, row.task.sequenceNumber),
      state: row.state,
      project: row.project,
      assignees: users,
      labels: taskLabelsList,
      agent: row.agent?.id ? row.agent : null,
      externalLinks: (links.get(row.task.id) ?? []).flatMap((link) =>
        isExternalType(link.externalType)
          ? [
              {
                id: link.id,
                externalType: link.externalType,
                externalId: link.externalId,
                externalUrl: link.externalUrl,
              },
            ]
          : []
      ),
      subtaskCount: counts?.total ?? 0,
      subtaskDoneCount: counts?.done ?? 0,
    };
  });
}

export const taskRefSelection = {
  id: tasks.id,
  title: tasks.title,
  sequenceNumber: tasks.sequenceNumber,
  projectId: tasks.projectId,
  stateId: tasks.stateId,
  stateCategory: taskStates.category,
  identifier: projects.identifier,
};

export interface TaskRefRow {
  id: string;
  title: string;
  sequenceNumber: number;
  projectId: string;
  stateId: string | null;
  stateCategory: string | null;
  identifier: string;
}

export function toTaskRef(row: TaskRefRow): TaskRef {
  return {
    id: row.id,
    key: formatTaskKey(row.identifier, row.sequenceNumber),
    title: row.title,
    projectId: row.projectId,
    stateId: row.stateId,
    stateCategory: row.stateCategory,
    done: row.stateCategory === 'done',
  };
}

/** Base query for task refs (join state + project). */
export function selectTaskRefs(db: DbExecutor) {
  return db
    .select(taskRefSelection)
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(taskStates, eq(tasks.stateId, taskStates.id))
    .$dynamic();
}
