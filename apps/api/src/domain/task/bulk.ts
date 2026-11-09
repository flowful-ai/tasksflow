/**
 * Bulk task operations (the board's floating bulk bar).
 *
 * One transaction for the whole request; each task runs in its own savepoint
 * so a task that fails validation (e.g. a label from another project) is
 * reported as `invalid` without rolling back the others. Access is decided by
 * the caller (the route knows roles/permissions) and passed in as the set of
 * project ids the actor may apply this op to.
 */
import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { projects, tasks } from '../../db/index.js';
import {
  ok,
  err,
  type BulkTaskItemResult,
  type BulkTaskOperation,
  type Result,
} from '@flowtask/shared';
import { domainEvents } from '../events/bus.js';
import type { TaskFieldChange } from '../events/types.js';
import { isTaskError, toError } from './errors.js';
import { placeTask } from './positions.js';
import {
  applySetChanges,
  recordTaskEvents,
  stateMetadata,
  stateSnapshots,
  completedAtFor,
  TaskService,
  type AssigneeLabelDiff,
} from './service.js';
import type { TaskEventInput, TaskWithRelations } from './types.js';
import { assertStateInProject, loadProjectScope, type ProjectScope } from './validation.js';

export interface BulkApplyInput {
  taskIds: string[];
  op: BulkTaskOperation;
  actorId: string | null;
  mcpClientId?: string | null;
  /** Projects the actor may apply this op in (checked per task). */
  allowedProjectIds: ReadonlySet<string>;
}

export interface BulkApplyResult {
  results: BulkTaskItemResult[];
  /** Fresh copies of every task that changed (deleted tasks excluded). */
  tasks: TaskWithRelations[];
  /** Workspace of the affected tasks (for realtime fan-out); null when nothing matched. */
  workspaceId: string | null;
}

interface TaskOutcome {
  taskId: string;
  project: ProjectScope;
  changes: TaskFieldChange[];
  diff: AssigneeLabelDiff;
  fromStateId: string | null;
  deleted: boolean;
  restored: boolean;
  title: string;
  sequenceNumber: number;
}

/** Look up the project of each task (deleted included), for the caller's access checks. */
export async function lookupTaskProjects(
  db: Database,
  taskIds: readonly string[]
): Promise<Map<string, { projectId: string; workspaceId: string }>> {
  const ids = [...new Set(taskIds)];
  const map = new Map<string, { projectId: string; workspaceId: string }>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ id: tasks.id, projectId: tasks.projectId, workspaceId: projects.workspaceId })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(inArray(tasks.id, ids));
  for (const row of rows)
    map.set(row.id, { projectId: row.projectId, workspaceId: row.workspaceId });
  return map;
}

export class TaskBulkService {
  private taskService: TaskService;

  constructor(private db: Database) {
    this.taskService = new TaskService(db);
  }

  async apply(input: BulkApplyInput): Promise<Result<BulkApplyResult, Error>> {
    try {
      const taskIds = [...new Set(input.taskIds)];
      const { op } = input;
      const results: BulkTaskItemResult[] = [];
      const outcomes: TaskOutcome[] = [];

      await this.db.transaction(async (tx) => {
        const rows = await tx
          .select({
            id: tasks.id,
            projectId: tasks.projectId,
            stateId: tasks.stateId,
            priority: tasks.priority,
            deletedAt: tasks.deletedAt,
            completedAt: tasks.completedAt,
            title: tasks.title,
            sequenceNumber: tasks.sequenceNumber,
          })
          .from(tasks)
          .where(inArray(tasks.id, taskIds))
          .orderBy(tasks.id)
          .for('update');
        const byId = new Map(rows.map((r) => [r.id, r]));
        const projectCache = new Map<string, ProjectScope>();

        for (const taskId of taskIds) {
          const row = byId.get(taskId);
          if (!row || (row.deletedAt && !op.restore)) {
            results.push({ taskId, status: 'not_found' });
            continue;
          }
          if (!input.allowedProjectIds.has(row.projectId)) {
            results.push({ taskId, status: 'forbidden' });
            continue;
          }
          let project = projectCache.get(row.projectId);
          if (!project) {
            project = await loadProjectScope(tx, row.projectId);
            projectCache.set(row.projectId, project);
          }
          const scope = project;

          try {
            const outcome = await tx.transaction(async (sp) => {
              const changes: TaskFieldChange[] = [];
              const events: TaskEventInput[] = [];
              const base = { taskId, actorId: input.actorId, mcpClientId: input.mcpClientId };
              let deleted = false;
              let restored = false;

              if (op.delete) {
                if (!row.deletedAt) {
                  await sp.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, taskId));
                  events.push({ ...base, eventType: 'deleted' });
                  deleted = true;
                }
                await recordTaskEvents(sp, events);
                return { changes, diff: emptyDiff(), deleted, restored };
              }

              if (op.restore && row.deletedAt) {
                await sp.update(tasks).set({ deletedAt: null }).where(eq(tasks.id, taskId));
                events.push({ ...base, eventType: 'restored' });
                restored = true;
              }

              const set: Partial<typeof tasks.$inferInsert> = {};
              if (op.stateId !== undefined && op.stateId !== row.stateId) {
                await assertStateInProject(sp, scope.id, op.stateId);
                const placement = await placeTask(sp, {
                  projectId: scope.id,
                  stateId: op.stateId,
                  taskId,
                });
                set.stateId = op.stateId;
                set.position = placement.position;
                set.completedAt = await completedAtFor(sp, op.stateId, row.completedAt);
                changes.push({ field: 'stateId', from: row.stateId, to: op.stateId });
                const snapshots = await stateSnapshots(sp, [row.stateId, op.stateId]);
                events.push({
                  ...base,
                  eventType: 'moved',
                  fieldName: 'stateId',
                  oldValue: row.stateId,
                  newValue: op.stateId,
                  metadata: stateMetadata(snapshots, row.stateId, op.stateId),
                });
              }
              if (op.priority !== undefined && op.priority !== row.priority) {
                set.priority = op.priority;
                changes.push({ field: 'priority', from: row.priority, to: op.priority });
                events.push({
                  ...base,
                  eventType: 'updated',
                  fieldName: 'priority',
                  oldValue: row.priority,
                  newValue: op.priority,
                });
              }

              const diff = await applySetChanges(sp, scope, taskId, {
                addAssigneeIds: op.addAssigneeIds,
                removeAssigneeIds: op.removeAssigneeIds,
                addLabelIds: op.addLabelIds,
                removeLabelIds: op.removeLabelIds,
              });
              events.push(
                ...diff.addedAssigneeIds.map(
                  (id): TaskEventInput => ({ ...base, eventType: 'assigned', newValue: id })
                ),
                ...diff.removedAssigneeIds.map(
                  (id): TaskEventInput => ({ ...base, eventType: 'unassigned', oldValue: id })
                ),
                ...diff.addedLabelIds.map(
                  (id): TaskEventInput => ({ ...base, eventType: 'labeled', newValue: id })
                ),
                ...diff.removedLabelIds.map(
                  (id): TaskEventInput => ({ ...base, eventType: 'unlabeled', oldValue: id })
                )
              );

              if (events.length > 0) {
                await sp
                  .update(tasks)
                  .set({ ...set, updatedAt: new Date() })
                  .where(eq(tasks.id, taskId));
                await recordTaskEvents(sp, events);
              }
              return { changes, diff, deleted, restored };
            });

            const changed =
              outcome.deleted ||
              outcome.restored ||
              outcome.changes.length > 0 ||
              outcome.diff.addedAssigneeIds.length +
                outcome.diff.removedAssigneeIds.length +
                outcome.diff.addedLabelIds.length +
                outcome.diff.removedLabelIds.length >
                0;
            results.push({ taskId, status: changed ? 'updated' : 'unchanged' });
            if (changed) {
              outcomes.push({
                taskId,
                project: scope,
                ...outcome,
                fromStateId: row.stateId,
                title: row.title,
                sequenceNumber: row.sequenceNumber,
              });
            }
          } catch (error) {
            const e = toError(error);
            if (!isTaskError(e)) throw e;
            results.push({ taskId, status: 'invalid', code: e.code, message: e.message });
          }
        }
      });

      const workspaceId = outcomes[0]?.project.workspaceId ?? null;
      const liveIds = outcomes.filter((o) => !o.deleted).map((o) => o.taskId);
      let fresh: TaskWithRelations[] = [];
      if (workspaceId && liveIds.length) {
        const listed = await this.taskService.list({
          filters: { workspaceId, ids: liveIds },
          limit: liveIds.length,
        });
        if (listed.ok) fresh = listed.value.tasks;
      }
      this.emit(outcomes, fresh, input);
      return ok({ results, tasks: fresh, workspaceId });
    } catch (error) {
      return err(toError(error));
    }
  }

  private emit(outcomes: TaskOutcome[], fresh: TaskWithRelations[], input: BulkApplyInput): void {
    const byId = new Map(fresh.map((t) => [t.id, t]));
    for (const o of outcomes) {
      const common = {
        workspaceId: o.project.workspaceId,
        projectId: o.project.id,
        actorId: input.actorId,
        mcpClientId: input.mcpClientId ?? null,
      };
      if (o.deleted) {
        domainEvents.emit('task.deleted', {
          ...common,
          taskId: o.taskId,
          title: o.title,
          sequenceNumber: o.sequenceNumber,
        });
        continue;
      }
      const task = byId.get(o.taskId);
      if (!task) continue;
      if (o.restored) domainEvents.emit('task.restored', { ...common, task });
      const setChanged =
        o.diff.addedAssigneeIds.length +
          o.diff.removedAssigneeIds.length +
          o.diff.addedLabelIds.length +
          o.diff.removedLabelIds.length >
        0;
      const onlyState = o.changes.length === 1 && o.changes[0]!.field === 'stateId' && !setChanged;
      if (onlyState) {
        domainEvents.emit('task.moved', {
          ...common,
          task,
          fromStateId: o.fromStateId,
          toStateId: task.stateId,
          positionOnly: false,
        });
      } else if (o.changes.length > 0 || setChanged) {
        domainEvents.emit('task.updated', { ...common, task, changes: o.changes, ...o.diff });
      }
    }
  }
}

function emptyDiff(): AssigneeLabelDiff {
  return { addedAssigneeIds: [], removedAssigneeIds: [], addedLabelIds: [], removedLabelIds: [] };
}
