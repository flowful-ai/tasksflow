/**
 * Due-date reminders (hourly job): for every live, not-done task with a due
 * date within the next 24h → `due_soon`; already past due → `overdue`. One
 * notification per assignee, per task, per type, per UTC day (dedupe key).
 */
import { and, eq, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { projects, taskAssignees, taskStates, tasks } from '../../db/index.js';
import type { JobHandler } from '../jobs/types.js';
import { NotificationService, type NotificationInput } from './service.js';

const HOUR_MS = 60 * 60 * 1000;
export const DUE_SOON_WINDOW_MS = 24 * HOUR_MS;
const SCAN_LIMIT = 5000;

export function reminderDedupeKey(type: 'due_soon' | 'overdue', taskId: string, now: Date): string {
  return `${type}:${taskId}:${now.toISOString().slice(0, 10)}`;
}

/** Run one scan; returns the number of notifications created. */
export async function runDueDateReminders(db: Database, now: Date = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + DUE_SOON_WINDOW_MS);
  const rows = await db
    .select({
      taskId: tasks.id,
      projectId: tasks.projectId,
      workspaceId: projects.workspaceId,
      dueDate: tasks.dueDate,
      userId: taskAssignees.userId,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
    .leftJoin(taskStates, eq(tasks.stateId, taskStates.id))
    .where(
      and(
        isNull(tasks.deletedAt),
        isNotNull(tasks.dueDate),
        lte(tasks.dueDate, horizon),
        eq(projects.isArchived, false),
        or(isNull(taskStates.category), ne(taskStates.category, 'done'))
      )
    )
    .limit(SCAN_LIMIT);

  const byTask = new Map<
    string,
    { projectId: string; workspaceId: string; dueDate: Date; userIds: string[] }
  >();
  for (const row of rows) {
    if (!row.dueDate) continue;
    const entry = byTask.get(row.taskId);
    if (entry) entry.userIds.push(row.userId);
    else
      byTask.set(row.taskId, {
        projectId: row.projectId,
        workspaceId: row.workspaceId,
        dueDate: row.dueDate,
        userIds: [row.userId],
      });
  }

  const inputs: NotificationInput[] = [];
  for (const [taskId, entry] of byTask) {
    const type = entry.dueDate.getTime() < now.getTime() ? 'overdue' : 'due_soon';
    inputs.push({
      userIds: entry.userIds,
      workspaceId: entry.workspaceId,
      projectId: entry.projectId,
      taskId,
      actorId: null,
      type,
      data: { dueDate: entry.dueDate.toISOString() },
      dedupeKey: reminderDedupeKey(type, taskId, now),
    });
  }
  const created = await new NotificationService(db).createMany(inputs);
  return created.length;
}

export const dueDateReminderHandler: JobHandler = async (_job, { db }) => {
  await runDueDateReminders(db);
};
