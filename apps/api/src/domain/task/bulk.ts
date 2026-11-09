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
import { projects, taskStates, tasks } from '../../db/index.js';
import {
  InvalidPositionError,
  generatePositions,
  ok,
  err,
  type BulkTaskItemResult,
  type BulkTaskOperation,
  type Result,
} from '@flowtask/shared';
import { domainEvents } from '../events/bus.js';
import type { TaskFieldChange } from '../events/types.js';
import type { Tx } from './db.js';
import { TaskError, isTaskError, toError } from './errors.js';
import { columnTail, lockColumn, placeTask } from './positions.js';
import {
  applySetChanges,
  recordTaskEvents,
  stateMetadata,
  stateSnapshots,
  completedAtForCategory,
  TaskService,
  type AssigneeLabelDiff,
} from './service.js';
import type { TaskEventInput, TaskWithRelations } from './types.js';
import { loadProjectScope, type ProjectScope } from './validation.js';

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
  /** A state change re-keyed a target column: other tasks' positions changed too. */
  rekeyed: boolean;
}

interface BulkTaskRow {
  id: string;
  projectId: string;
  stateId: string | null;
  deletedAt: Date | null;
}

/** The target state of a bulk state change, resolved once for every task. */
interface StateChangePlan {
  stateId: string;
  /** null when the state does not exist (every mover is then invalid). */
  projectId: string | null;
  category: string | null;
  snapshots: Awaited<ReturnType<typeof stateSnapshots>>;
  /** Pre-reserved keys (appended after the column tail, in request order); empty when the tail needs a re-key. */
  keys: Map<string, string>;
}

/**
 * Validate the target state once, take its column lock, and reserve one key
 * per task that moves into it with a single generatePositions call after the
 * column's last key. When that key is invalid, `keys` stays empty and each
 * task falls back to placeTask (which re-keys the column).
 */
async function planStateChange(
  tx: Tx,
  stateId: string,
  taskIds: readonly string[],
  byId: ReadonlyMap<string, BulkTaskRow>,
  input: BulkApplyInput
): Promise<StateChangePlan> {
  const [state] = await tx
    .select({ projectId: taskStates.projectId, category: taskStates.category })
    .from(taskStates)
    .where(eq(taskStates.id, stateId));
  const movers = taskIds.filter((taskId) => {
    const row = byId.get(taskId);
    return (
      row !== undefined &&
      (!row.deletedAt || input.op.restore) &&
      input.allowedProjectIds.has(row.projectId) &&
      row.projectId === state?.projectId &&
      row.stateId !== stateId
    );
  });
  const plan: StateChangePlan = {
    stateId,
    projectId: state?.projectId ?? null,
    category: state?.category ?? null,
    snapshots: await stateSnapshots(tx, [
      stateId,
      ...movers.map((taskId) => byId.get(taskId)?.stateId ?? null),
    ]),
    keys: new Map(),
  };
  if (!state || movers.length === 0) return plan;

  await lockColumn(tx, state.projectId, stateId);
  const tail = await columnTail(tx, state.projectId, stateId);
  try {
    const keys = generatePositions(movers.length, tail?.position ?? null, null);
    movers.forEach((taskId, i) => {
      const key = keys[i];
      if (key !== undefined) plan.keys.set(taskId, key);
    });
  } catch (error) {
    if (!(error instanceof InvalidPositionError)) throw error;
  }
  return plan;
}

interface TaskOutcome {
  taskId: string;
  project: ProjectScope;
  changes: TaskFieldChange[];
  diff: AssigneeLabelDiff;
  fromStateId: string | null;
  deleted: boolean;
  restored: boolean;
  /** The target column was re-keyed to place this task. */
  rekeyed: boolean;
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
        const statePlan =
          op.stateId !== undefined && !op.delete
            ? await planStateChange(tx, op.stateId, taskIds, byId, input)
            : null;

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
              let rekeyed = false;

              if (op.delete) {
                if (!row.deletedAt) {
                  await sp.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, taskId));
                  events.push({ ...base, eventType: 'deleted' });
                  deleted = true;
                }
                await recordTaskEvents(sp, events);
                return { changes, diff: emptyDiff(), deleted, restored, rekeyed };
              }

              if (op.restore && row.deletedAt) {
                await sp.update(tasks).set({ deletedAt: null }).where(eq(tasks.id, taskId));
                events.push({ ...base, eventType: 'restored' });
                restored = true;
              }

              const set: Partial<typeof tasks.$inferInsert> = {};
              if (statePlan && statePlan.stateId !== row.stateId) {
                const toStateId = statePlan.stateId;
                if (statePlan.projectId !== scope.id) {
                  throw new TaskError('INVALID_STATE', 'State does not belong to this project', [
                    toStateId,
                  ]);
                }
                const reserved = statePlan.keys.get(taskId);
                if (reserved !== undefined) {
                  set.position = reserved;
                } else {
                  const placement = await placeTask(sp, {
                    projectId: scope.id,
                    stateId: toStateId,
                    taskId,
                  });
                  set.position = placement.position;
                  rekeyed = placement.rekeyed;
                }
                set.stateId = toStateId;
                set.completedAt = completedAtForCategory(statePlan.category, row.completedAt);
                changes.push({ field: 'stateId', from: row.stateId, to: toStateId });
                events.push({
                  ...base,
                  eventType: 'moved',
                  fieldName: 'stateId',
                  oldValue: row.stateId,
                  newValue: toStateId,
                  metadata: stateMetadata(statePlan.snapshots, row.stateId, toStateId),
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
              return { changes, diff, deleted, restored, rekeyed };
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
          skipCount: true,
        });
        if (listed.ok) fresh = listed.value.tasks;
      }
      this.emit(outcomes, fresh, input);
      const rekeyed = outcomes.some((o) => o.rekeyed);
      return ok({ results, tasks: fresh, workspaceId, rekeyed });
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

    // A re-key rewrote other tasks' positions: clients refetch the column (once per column).
    const rekeyed = new Map<string, { workspaceId: string; projectId: string; stateId: string }>();
    for (const o of outcomes) {
      const stateId = o.changes.find((change) => change.field === 'stateId')?.to;
      if (!o.rekeyed || typeof stateId !== 'string') continue;
      rekeyed.set(`${o.project.id}:${stateId}`, {
        workspaceId: o.project.workspaceId,
        projectId: o.project.id,
        stateId,
      });
    }
    for (const column of rekeyed.values()) domainEvents.emit('tasks.rekeyed', column);
  }
}

function emptyDiff(): AssigneeLabelDiff {
  return { addedAssigneeIds: [], removedAssigneeIds: [], addedLabelIds: [], removedLabelIds: [] };
}
