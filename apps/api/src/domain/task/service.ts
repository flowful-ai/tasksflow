import { escapeLike } from '@flowtask/shared';
import {
  eq,
  and,
  or,
  inArray,
  isNull,
  isNotNull,
  sql,
  desc,
  asc,
  ilike,
  lt,
  gt,
  type SQL,
} from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import {
  tasks,
  taskStates,
  taskAssignees,
  taskLabels,
  taskEvents,
  taskRelations,
  projects,
  externalLinks,
  workspaceAgents,
} from '../../db/index.js';
import { parseTaskKey, ok, err } from '@flowtask/shared';
import type { JsonValue, Result } from '@flowtask/shared';
import { BufferedEventSink, domainEvents, type DomainEventSink } from '../events/bus.js';
import type { TaskFieldChange } from '../events/types.js';
import type { DbExecutor, Tx } from './db.js';
import { TaskError, toError } from './errors.js';
import { placeTask, positionOrder } from './positions.js';
import {
  hydrateTasks,
  selectTaskRefs,
  taskRowSelection,
  toTaskRef,
  type TaskRowWithJoins,
} from './queries.js';
import {
  assertAssigneesCanAccess,
  assertLabelsInProject,
  assertStateInProject,
  assertValidParent,
  loadProjectScope,
  type ProjectScope,
} from './validation.js';
import type {
  TaskWithRelations,
  TaskDetail,
  TaskCreateInput,
  TaskUpdateInput,
  TaskMoveInput,
  ExternalLinkInput,
  TaskFilters,
  TaskListOptions,
  TaskEventInput,
  GetTaskOptions,
} from './types.js';

type JoinName = 'task_states' | 'task_assignees' | 'task_labels';

/**
 * Whether the list query must join task_assignees. Assignee filters now use
 * EXISTS subqueries, so this is only true for legacy filterSql that references
 * task_assignees columns directly.
 */
export function taskListNeedsAssigneeJoin(
  _filters: TaskFilters,
  requiredJoins: Set<JoinName>
): boolean {
  return requiredJoins.has('task_assignees');
}

/** Assignee filter conditions (EXISTS subqueries: no join, no duplicate rows). */
export function buildTaskAssigneeConditions(filters: TaskFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.assigneeId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${taskAssignees} WHERE ${taskAssignees.taskId} = ${tasks.id} AND ${taskAssignees.userId} = ${filters.assigneeId})`
    );
  }
  if (filters.assigneeIds?.length) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${taskAssignees} WHERE ${taskAssignees.taskId} = ${tasks.id} AND ${inArray(taskAssignees.userId, filters.assigneeIds)})`
    );
  }
  return conditions;
}

/** Label filter conditions (EXISTS subqueries). */
export function buildTaskLabelConditions(filters: TaskFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.labelId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${taskLabels} WHERE ${taskLabels.taskId} = ${tasks.id} AND ${taskLabels.labelId} = ${filters.labelId})`
    );
  }
  if (filters.labelIds?.length) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${taskLabels} WHERE ${taskLabels.taskId} = ${tasks.id} AND ${inArray(taskLabels.labelId, filters.labelIds)})`
    );
  }
  return conditions;
}

/** Lower-cased word tokens of a query, safe to embed in a to_tsquery string. */
export function searchTokens(query: string): string[] {
  return (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
}

/** "lexico graph" → "lexico:* & graph:*" (tokens are letters/digits only). */
export function buildPrefixTsQuery(query: string): string | null {
  const tokens = searchTokens(query);
  return tokens.length ? tokens.map((t) => `${t}:*`).join(' & ') : null;
}

/** Text-search condition: tsvector match, prefix match, ILIKE prefix for short queries. */
export function buildTextSearchCondition(query: string): SQL {
  const q = query.trim();
  const parts: SQL[] = [sql`${tasks.searchVector} @@ websearch_to_tsquery('simple', ${q})`];
  const prefix = buildPrefixTsQuery(q);
  if (prefix) parts.push(sql`${tasks.searchVector} @@ to_tsquery('simple', ${prefix})`);
  if (q.length < 3) {
    parts.push(ilike(tasks.title, `${escapeLike(q)}%`));
    parts.push(ilike(tasks.title, `% ${escapeLike(q)}%`));
  }
  return or(...parts)!;
}

/** Condition matching a task key ("TF-12"). */
export function buildTaskKeyCondition(identifier: string, sequenceNumber: number): SQL {
  return and(
    sql`upper(${projects.identifier}) = ${identifier}`,
    eq(tasks.sequenceNumber, sequenceNumber)
  )!;
}

const PRIORITY_RANK = sql`CASE ${tasks.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 WHEN 'none' THEN 4 ELSE 5 END`;

function toJson(value: Date | string | number | null | undefined): JsonValue {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function sameValue(
  a: Date | string | null | undefined,
  b: Date | string | null | undefined
): boolean {
  const left = a instanceof Date ? a.getTime() : (a ?? null);
  const right = b instanceof Date ? b.getTime() : (b ?? null);
  return left === right;
}

/** Insert task events (one statement). */
export async function recordTaskEvents(
  db: DbExecutor,
  inputs: readonly TaskEventInput[]
): Promise<void> {
  if (inputs.length === 0) return;
  await db.insert(taskEvents).values(
    inputs.map((input) => ({
      taskId: input.taskId,
      actorId: input.actorId,
      mcpClientId: input.mcpClientId || null,
      eventType: input.eventType,
      fieldName: input.fieldName || null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      metadata: input.metadata ?? null,
    }))
  );
}

/**
 * completed_at for a task landing in `stateId`: kept when it was already
 * completed and stays done (done → done keeps the original time), stamped
 * now when it enters done, cleared otherwise.
 */
export async function completedAtFor(
  db: DbExecutor,
  stateId: string | null,
  current: Date | null
): Promise<Date | null> {
  if (!stateId) return null;
  const [state] = await db
    .select({ category: taskStates.category })
    .from(taskStates)
    .where(eq(taskStates.id, stateId))
    .limit(1);
  return completedAtForCategory(state?.category ?? null, current);
}

/** completedAtFor when the target state's category is already known. */
export function completedAtForCategory(category: string | null, current: Date | null): Date | null {
  if (category !== 'done') return null;
  return current ?? new Date();
}

/** {id, name, category} snapshots for states, for event metadata. */
export async function stateSnapshots(
  db: DbExecutor,
  stateIds: readonly (string | null)[]
): Promise<Map<string, { id: string; name: string; category: string }>> {
  const ids = [...new Set(stateIds.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, { id: string; name: string; category: string }>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ id: taskStates.id, name: taskStates.name, category: taskStates.category })
    .from(taskStates)
    .where(inArray(taskStates.id, ids));
  for (const row of rows) map.set(row.id, row);
  return map;
}

export function stateMetadata(
  snapshots: Map<string, { id: string; name: string; category: string }>,
  fromId: string | null,
  toId: string | null
): JsonValue {
  const from = fromId ? snapshots.get(fromId) : undefined;
  const to = toId ? snapshots.get(toId) : undefined;
  return {
    from: from ? { id: from.id, name: from.name, category: from.category } : null,
    to: to ? { id: to.id, name: to.name, category: to.category } : null,
  };
}

/** Lock a live task row for update; throws TASK_NOT_FOUND. */
export async function lockTask(
  db: DbExecutor,
  taskId: string,
  opts: { includeDeleted?: boolean } = {}
) {
  const conditions: SQL[] = [eq(tasks.id, taskId)];
  if (!opts.includeDeleted) conditions.push(isNull(tasks.deletedAt));
  const [row] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      stateId: tasks.stateId,
      parentId: tasks.parentId,
      title: tasks.title,
      description: tasks.description,
      priority: tasks.priority,
      position: tasks.position,
      dueDate: tasks.dueDate,
      startDate: tasks.startDate,
      sequenceNumber: tasks.sequenceNumber,
      deletedAt: tasks.deletedAt,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(and(...conditions))
    .for('update');
  if (!row) throw new TaskError('TASK_NOT_FOUND', 'Task not found', [taskId]);
  return row;
}

export type LockedTask = Awaited<ReturnType<typeof lockTask>>;

/** Allocate the next sequence number for a project (row-locks the project until commit). */
export async function allocateSequenceNumber(db: DbExecutor, projectId: string): Promise<number> {
  // GREATEST(...) self-heals a counter that was never backfilled.
  const rows = await db.execute<{ seq: number }>(sql`
    UPDATE projects
    SET next_task_seq = GREATEST(
      next_task_seq,
      (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM tasks WHERE project_id = ${projectId})
    ) + 1
    WHERE id = ${projectId}
    RETURNING next_task_seq - 1 AS seq
  `);
  const seq = rows[0]?.seq;
  if (seq === undefined) throw new TaskError('PROJECT_NOT_FOUND', 'Project not found', [projectId]);
  return Number(seq);
}

interface AssigneeLabelDiff {
  addedAssigneeIds: string[];
  removedAssigneeIds: string[];
  addedLabelIds: string[];
  removedLabelIds: string[];
}

export class TaskService {
  /**
   * `db` may be an open transaction (see `TaskService.transaction`); `events`
   * is where domain events go, the process-wide bus by default.
   */
  constructor(
    private db: DbExecutor,
    private events: DomainEventSink = domainEvents
  ) {}

  /**
   * Run several task operations in ONE database transaction. Each service call
   * inside `fn` becomes a savepoint of the outer transaction, and the domain
   * events they emit are held back until the outer transaction commits (and
   * dropped if it rolls back), so listeners never see uncommitted data.
   */
  static async transaction<T>(
    db: Database,
    fn: (service: TaskService, tx: Tx) => Promise<T>
  ): Promise<T> {
    const buffer = new BufferedEventSink(domainEvents);
    const result = await db.transaction((tx) => fn(new TaskService(tx, buffer), tx));
    buffer.flush();
    return result;
  }

  /**
   * Create a new task in a project. One transaction: sequence allocation
   * (UPDATE projects … RETURNING), validation, position, task, assignees,
   * labels and the 'created' event.
   */
  async create(input: TaskCreateInput): Promise<Result<TaskDetail, Error>> {
    try {
      const { taskId, project, rekeyed, stateId } = await this.db.transaction(async (tx) => {
        const project = await loadProjectScope(tx, input.projectId);

        let stateId = input.stateId ?? null;
        if (stateId) {
          await assertStateInProject(tx, project.id, stateId);
        } else {
          const [defaultState] = await tx
            .select({ id: taskStates.id })
            .from(taskStates)
            .where(and(eq(taskStates.projectId, project.id), eq(taskStates.category, 'backlog')))
            .orderBy(sql`${taskStates.position} COLLATE "C"`, asc(taskStates.id))
            .limit(1);
          stateId = defaultState?.id ?? null;
        }

        if (input.labelIds?.length) await assertLabelsInProject(tx, project.id, input.labelIds);
        if (input.assigneeIds?.length)
          await assertAssigneesCanAccess(tx, project, input.assigneeIds);
        if (input.parentId) await assertValidParent(tx, project.id, input.parentId);

        const sequenceNumber = await allocateSequenceNumber(tx, project.id);
        const placement = await placeTask(tx, { projectId: project.id, stateId });

        const [task] = await tx
          .insert(tasks)
          .values({
            projectId: project.id,
            stateId,
            sequenceNumber,
            title: input.title,
            description: input.description || null,
            priority: input.priority || null,
            position: placement.position,
            completedAt: await completedAtFor(tx, stateId, null),
            parentId: input.parentId ?? null,
            dueDate: input.dueDate || null,
            startDate: input.startDate || null,
            createdBy: input.createdBy,
            agentId: input.agentId || null,
          })
          .returning({ id: tasks.id });
        if (!task) throw new Error('Failed to create task');

        const assigneeIds = [...new Set(input.assigneeIds ?? [])];
        if (assigneeIds.length) {
          await tx
            .insert(taskAssignees)
            .values(assigneeIds.map((userId) => ({ taskId: task.id, userId })));
        }
        const labelIds = [...new Set(input.labelIds ?? [])];
        if (labelIds.length) {
          await tx
            .insert(taskLabels)
            .values(labelIds.map((labelId) => ({ taskId: task.id, labelId })));
        }

        await recordTaskEvents(tx, [
          {
            taskId: task.id,
            actorId: input.createdBy,
            mcpClientId: input.mcpClientId,
            eventType: 'created',
            newValue: input.parentId ? { parentId: input.parentId } : null,
          },
        ]);
        return { taskId: task.id, project, rekeyed: placement.rekeyed, stateId };
      });

      const result = await this.getById(taskId);
      if (result.ok) {
        this.events.emit('task.created', {
          task: result.value,
          workspaceId: project.workspaceId,
          projectId: project.id,
          actorId: input.createdBy,
          mcpClientId: input.mcpClientId ?? null,
          ...(input.skipGitHubSync ? { origin: 'github' as const } : {}),
        });
        if (rekeyed) this.emitRekeyed(project, stateId);
      }
      return result;
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Get a task by ID with relations, parent, sub-tasks and blocking relations.
   * Soft-deleted tasks are excluded unless `includeDeleted` is set.
   */
  async getById(taskId: string, options: GetTaskOptions = {}): Promise<Result<TaskDetail, Error>> {
    try {
      return ok(await this.loadDetail(this.db, taskId, options));
    } catch (error) {
      return err(toError(error));
    }
  }

  private async loadDetail(
    db: DbExecutor,
    taskId: string,
    options: GetTaskOptions
  ): Promise<TaskDetail> {
    const conditions: SQL[] = [eq(tasks.id, taskId)];
    if (!options.includeDeleted) conditions.push(isNull(tasks.deletedAt));

    const rows: TaskRowWithJoins[] = await db
      .select(taskRowSelection)
      .from(tasks)
      .leftJoin(taskStates, eq(tasks.stateId, taskStates.id))
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(workspaceAgents, eq(tasks.agentId, workspaceAgents.id))
      .where(and(...conditions));
    const [task] = await hydrateTasks(db, rows);
    if (!task) throw new TaskError('TASK_NOT_FOUND', 'Task not found', [taskId]);

    const [parentRows, subtaskRows, blocksRows, blockedByRows] = await Promise.all([
      task.parentId
        ? selectTaskRefs(db).where(and(eq(tasks.id, task.parentId), isNull(tasks.deletedAt)))
        : Promise.resolve([]),
      selectTaskRefs(db)
        .where(and(eq(tasks.parentId, taskId), isNull(tasks.deletedAt)))
        .orderBy(...positionOrder()),
      selectTaskRefs(db)
        .innerJoin(taskRelations, eq(taskRelations.relatedTaskId, tasks.id))
        .where(
          and(
            eq(taskRelations.taskId, taskId),
            eq(taskRelations.type, 'blocks'),
            isNull(tasks.deletedAt)
          )
        ),
      selectTaskRefs(db)
        .innerJoin(taskRelations, eq(taskRelations.taskId, tasks.id))
        .where(
          and(
            eq(taskRelations.relatedTaskId, taskId),
            eq(taskRelations.type, 'blocks'),
            isNull(tasks.deletedAt)
          )
        ),
    ]);

    return {
      ...task,
      parent: parentRows[0] ? toTaskRef(parentRows[0]) : null,
      subtasks: subtaskRows.map(toTaskRef),
      blocks: blocksRows.map(toTaskRef),
      blockedBy: blockedByRows.map(toTaskRef),
    };
  }

  /**
   * Update a task. Validates foreign ids, re-places the task when its state or
   * position changes, replaces assignee/label sets when given, and records one
   * event per changed field.
   */
  async update(taskId: string, input: TaskUpdateInput): Promise<Result<TaskDetail, Error>> {
    try {
      const outcome = await this.db.transaction(async (tx) => {
        const current = await lockTask(tx, taskId);
        const project = await loadProjectScope(tx, current.projectId);

        const stateChanged = input.stateId !== undefined && input.stateId !== current.stateId;
        if (stateChanged && input.stateId)
          await assertStateInProject(tx, project.id, input.stateId);
        if (input.parentId) await assertValidParent(tx, project.id, input.parentId, taskId);
        if (input.labelIds) await assertLabelsInProject(tx, project.id, input.labelIds);
        if (input.assigneeIds) await assertAssigneesCanAccess(tx, project, input.assigneeIds);

        const set: Partial<typeof tasks.$inferInsert> = {};
        const changes: TaskFieldChange[] = [];
        const track = (
          field: TaskFieldChange['field'],
          from: Date | string | null,
          to: Date | string | null | undefined
        ) => {
          if (to === undefined || sameValue(from, to)) return false;
          changes.push({ field, from: toJson(from), to: toJson(to) });
          return true;
        };

        if (input.title !== undefined && track('title', current.title, input.title))
          set.title = input.title;
        if (
          input.description !== undefined &&
          track('description', current.description, input.description ?? null)
        ) {
          set.description = input.description ?? null;
        }
        if (input.priority !== undefined && track('priority', current.priority, input.priority)) {
          set.priority = input.priority;
        }
        if (input.dueDate !== undefined && track('dueDate', current.dueDate, input.dueDate))
          set.dueDate = input.dueDate;
        if (
          input.startDate !== undefined &&
          track('startDate', current.startDate, input.startDate)
        ) {
          set.startDate = input.startDate;
        }
        if (input.parentId !== undefined && track('parentId', current.parentId, input.parentId)) {
          set.parentId = input.parentId;
        }
        const targetStateId = input.stateId !== undefined ? input.stateId : current.stateId;
        if (stateChanged) {
          track('stateId', current.stateId, input.stateId);
          set.stateId = input.stateId;
          set.completedAt = await completedAtFor(tx, input.stateId ?? null, current.completedAt);
        }

        let rekeyed = false;
        const positionChanged = input.position !== undefined && input.position !== current.position;
        if (stateChanged || positionChanged) {
          const placement = await placeTask(tx, {
            projectId: project.id,
            stateId: targetStateId,
            taskId,
            position: input.position,
          });
          set.position = placement.position;
          rekeyed = placement.rekeyed;
        }

        const diff = await this.replaceSets(tx, taskId, input.assigneeIds, input.labelIds);

        const hasRowChange = Object.keys(set).length > 0;
        const hasSetChange =
          diff.addedAssigneeIds.length +
            diff.removedAssigneeIds.length +
            diff.addedLabelIds.length +
            diff.removedLabelIds.length >
          0;
        if (hasRowChange || hasSetChange) {
          await tx
            .update(tasks)
            .set({ ...set, updatedAt: new Date() })
            .where(eq(tasks.id, taskId));
        }

        const snapshots = stateChanged
          ? await stateSnapshots(tx, [current.stateId, input.stateId ?? null])
          : new Map<string, { id: string; name: string; category: string }>();
        const events: TaskEventInput[] = changes.map((change) =>
          change.field === 'stateId'
            ? {
                taskId,
                actorId: input.updatedBy,
                mcpClientId: input.mcpClientId,
                eventType: 'moved',
                fieldName: 'stateId',
                oldValue: change.from,
                newValue: change.to,
                metadata: stateMetadata(snapshots, current.stateId, input.stateId ?? null),
              }
            : {
                taskId,
                actorId: input.updatedBy,
                mcpClientId: input.mcpClientId,
                eventType: 'updated',
                fieldName: change.field,
                oldValue: change.from,
                newValue: change.to,
              }
        );
        events.push(...this.setChangeEvents(taskId, input.updatedBy, input.mcpClientId, diff));
        await recordTaskEvents(tx, events);

        return {
          project,
          changes,
          diff,
          rekeyed,
          stateId: targetStateId,
          previousDescription: current.description,
          changed: hasRowChange || hasSetChange,
        };
      });

      const result = await this.getById(taskId);
      if (result.ok && outcome.changed) {
        this.events.emit('task.updated', {
          task: result.value,
          workspaceId: outcome.project.workspaceId,
          projectId: outcome.project.id,
          actorId: input.updatedBy,
          mcpClientId: input.mcpClientId ?? null,
          ...(input.skipGitHubSync ? { origin: 'github' as const } : {}),
          changes: outcome.changes,
          ...outcome.diff,
          previousDescription: outcome.changes.some((c) => c.field === 'description')
            ? outcome.previousDescription
            : undefined,
        });
        if (outcome.rekeyed) this.emitRekeyed(outcome.project, outcome.stateId);
      }
      return result;
    } catch (error) {
      return err(toError(error));
    }
  }

  /** Replace assignee and/or label sets; returns what was added/removed. */
  private async replaceSets(
    tx: DbExecutor,
    taskId: string,
    assigneeIds: string[] | undefined,
    labelIds: string[] | undefined
  ): Promise<AssigneeLabelDiff> {
    const diff: AssigneeLabelDiff = {
      addedAssigneeIds: [],
      removedAssigneeIds: [],
      addedLabelIds: [],
      removedLabelIds: [],
    };
    if (assigneeIds) {
      const existing = new Set(
        (
          await tx
            .select({ id: taskAssignees.userId })
            .from(taskAssignees)
            .where(eq(taskAssignees.taskId, taskId))
        ).map((r) => r.id)
      );
      const wanted = new Set(assigneeIds);
      diff.addedAssigneeIds = [...wanted].filter((id) => !existing.has(id));
      diff.removedAssigneeIds = [...existing].filter((id) => !wanted.has(id));
      if (diff.removedAssigneeIds.length) {
        await tx
          .delete(taskAssignees)
          .where(
            and(
              eq(taskAssignees.taskId, taskId),
              inArray(taskAssignees.userId, diff.removedAssigneeIds)
            )
          );
      }
      if (diff.addedAssigneeIds.length) {
        await tx
          .insert(taskAssignees)
          .values(diff.addedAssigneeIds.map((userId) => ({ taskId, userId })))
          .onConflictDoNothing();
      }
    }
    if (labelIds) {
      const existing = new Set(
        (
          await tx
            .select({ id: taskLabels.labelId })
            .from(taskLabels)
            .where(eq(taskLabels.taskId, taskId))
        ).map((r) => r.id)
      );
      const wanted = new Set(labelIds);
      diff.addedLabelIds = [...wanted].filter((id) => !existing.has(id));
      diff.removedLabelIds = [...existing].filter((id) => !wanted.has(id));
      if (diff.removedLabelIds.length) {
        await tx
          .delete(taskLabels)
          .where(
            and(eq(taskLabels.taskId, taskId), inArray(taskLabels.labelId, diff.removedLabelIds))
          );
      }
      if (diff.addedLabelIds.length) {
        await tx
          .insert(taskLabels)
          .values(diff.addedLabelIds.map((labelId) => ({ taskId, labelId })))
          .onConflictDoNothing();
      }
    }
    return diff;
  }

  private setChangeEvents(
    taskId: string,
    actorId: string | null,
    mcpClientId: string | null | undefined,
    diff: AssigneeLabelDiff
  ): TaskEventInput[] {
    return [
      ...diff.addedAssigneeIds.map(
        (id): TaskEventInput => ({
          taskId,
          actorId,
          mcpClientId,
          eventType: 'assigned',
          newValue: id,
        })
      ),
      ...diff.removedAssigneeIds.map(
        (id): TaskEventInput => ({
          taskId,
          actorId,
          mcpClientId,
          eventType: 'unassigned',
          oldValue: id,
        })
      ),
      ...diff.addedLabelIds.map(
        (id): TaskEventInput => ({
          taskId,
          actorId,
          mcpClientId,
          eventType: 'labeled',
          newValue: id,
        })
      ),
      ...diff.removedLabelIds.map(
        (id): TaskEventInput => ({
          taskId,
          actorId,
          mcpClientId,
          eventType: 'unlabeled',
          oldValue: id,
        })
      ),
    ];
  }

  /**
   * Move a task to a state and/or position. The target state must belong to
   * the task's project. The key is computed server-side from afterTaskId /
   * beforeTaskId inside the transaction; an
   * invalid neighbour triggers a re-key of the column.
   */
  async move(taskId: string, input: TaskMoveInput): Promise<Result<TaskDetail, Error>> {
    try {
      const outcome = await this.db.transaction(async (tx) => {
        const current = await lockTask(tx, taskId);
        const project = await loadProjectScope(tx, current.projectId);
        await assertStateInProject(tx, project.id, input.stateId);

        const placement = await placeTask(tx, {
          projectId: project.id,
          stateId: input.stateId,
          taskId,
          afterTaskId: input.afterTaskId,
          beforeTaskId: input.beforeTaskId,
        });

        await tx
          .update(tasks)
          .set({
            stateId: input.stateId,
            position: placement.position,
            completedAt: await completedAtFor(tx, input.stateId, current.completedAt),
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, taskId));

        const stateChanged = current.stateId !== input.stateId;
        if (stateChanged) {
          const snapshots = await stateSnapshots(tx, [current.stateId, input.stateId]);
          await recordTaskEvents(tx, [
            {
              taskId,
              actorId: input.movedBy,
              mcpClientId: input.mcpClientId,
              eventType: 'moved',
              fieldName: 'stateId',
              oldValue: current.stateId,
              newValue: input.stateId,
              metadata: stateMetadata(snapshots, current.stateId, input.stateId),
            },
          ]);
        }
        return { project, fromStateId: current.stateId, stateChanged, rekeyed: placement.rekeyed };
      });

      const result = await this.getById(taskId);
      if (result.ok) {
        this.events.emit('task.moved', {
          task: result.value,
          workspaceId: outcome.project.workspaceId,
          projectId: outcome.project.id,
          actorId: input.movedBy,
          mcpClientId: input.mcpClientId ?? null,
          ...(input.skipGitHubSync ? { origin: 'github' as const } : {}),
          fromStateId: outcome.fromStateId,
          toStateId: input.stateId,
          positionOnly: !outcome.stateChanged,
        });
        if (outcome.rekeyed) this.emitRekeyed(outcome.project, input.stateId);
      }
      return result;
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Link a task to an external item (GitHub issue or pull request), record it
   * in the task history and emit `task.updated` with the full task. Returns
   * `linked: false` (and emits nothing) when that item is already linked.
   */
  async linkExternal(input: ExternalLinkInput): Promise<Result<{ linked: boolean }, Error>> {
    try {
      const outcome = await this.db.transaction(async (tx) => {
        const current = await lockTask(tx, input.taskId);
        const [inserted] = await tx
          .insert(externalLinks)
          .values({
            integrationId: input.integrationId,
            taskId: input.taskId,
            externalType: input.externalType,
            externalId: input.externalId,
            externalUrl: input.externalUrl,
            syncHash: input.syncHash ?? null,
            lastSyncedAt: new Date(),
          })
          .onConflictDoNothing({
            target: [
              externalLinks.integrationId,
              externalLinks.externalType,
              externalLinks.externalId,
            ],
          })
          .returning({ id: externalLinks.id });
        if (!inserted) return null;
        await recordTaskEvents(tx, [
          {
            taskId: input.taskId,
            actorId: input.actorId,
            mcpClientId: input.mcpClientId,
            eventType: 'linked',
            newValue: input.externalId,
            metadata: { externalType: input.externalType, url: input.externalUrl },
          },
        ]);
        return { project: await loadProjectScope(tx, current.projectId) };
      });
      if (!outcome) return ok({ linked: false });

      const task = await this.getById(input.taskId);
      if (task.ok) {
        this.events.emit('task.updated', {
          task: task.value,
          workspaceId: outcome.project.workspaceId,
          projectId: outcome.project.id,
          actorId: input.actorId,
          mcpClientId: input.mcpClientId ?? null,
          ...(input.origin ? { origin: input.origin } : {}),
          changes: [],
          addedAssigneeIds: [],
          removedAssigneeIds: [],
          addedLabelIds: [],
          removedLabelIds: [],
        });
      }
      return ok({ linked: true });
    } catch (error) {
      return err(toError(error));
    }
  }

  /** Soft delete a task (idempotent: deleting a deleted task is a no-op). */
  async delete(
    taskId: string,
    deletedBy: string | null,
    options?: { mcpClientId?: string | null }
  ): Promise<Result<void, Error>> {
    try {
      const outcome = await this.db.transaction(async (tx) => {
        const current = await lockTask(tx, taskId, { includeDeleted: true });
        if (current.deletedAt) return null;
        const project = await loadProjectScope(tx, current.projectId);
        await tx.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, taskId));
        await recordTaskEvents(tx, [
          { taskId, actorId: deletedBy, mcpClientId: options?.mcpClientId, eventType: 'deleted' },
        ]);
        return { project, current };
      });
      if (outcome) {
        this.events.emit('task.deleted', {
          taskId,
          title: outcome.current.title,
          sequenceNumber: outcome.current.sequenceNumber,
          workspaceId: outcome.project.workspaceId,
          projectId: outcome.project.id,
          actorId: deletedBy,
          mcpClientId: options?.mcpClientId ?? null,
        });
      }
      return ok(undefined);
    } catch (error) {
      return err(toError(error));
    }
  }

  /** Restore a soft-deleted task (a live task is returned unchanged). */
  async restore(
    taskId: string,
    restoredBy: string | null,
    options?: { mcpClientId?: string | null }
  ): Promise<Result<TaskDetail, Error>> {
    try {
      const outcome = await this.db.transaction(async (tx) => {
        const current = await lockTask(tx, taskId, { includeDeleted: true });
        if (!current.deletedAt) return null;
        const project = await loadProjectScope(tx, current.projectId);
        await tx
          .update(tasks)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(eq(tasks.id, taskId));
        await recordTaskEvents(tx, [
          { taskId, actorId: restoredBy, mcpClientId: options?.mcpClientId, eventType: 'restored' },
        ]);
        return { project };
      });
      const result = await this.getById(taskId);
      if (result.ok && outcome) {
        this.events.emit('task.restored', {
          task: result.value,
          workspaceId: outcome.project.workspaceId,
          projectId: outcome.project.id,
          actorId: restoredBy,
          mcpClientId: options?.mcpClientId ?? null,
        });
      }
      return result;
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * List tasks with filtering and pagination.
   *
   * Safe by default: returns a MISSING_SCOPE error unless one of projectId,
   * projectIds or workspaceId is given (an empty projectIds matches nothing).
   * Ordering always ends with tasks.id so pages are deterministic.
   */
  async list(
    options: TaskListOptions = {}
  ): Promise<Result<{ tasks: TaskWithRelations[]; total: number }, Error>> {
    try {
      const {
        filters = {},
        filterSql,
        requiredJoins = new Set<JoinName>(),
        sortBy = 'position',
        sortOrder = 'asc',
        page = 1,
        limit = 50,
        skipCount = false,
      } = options;

      if (!filters.projectId && !filters.projectIds && !filters.workspaceId) {
        return err(
          new TaskError(
            'MISSING_SCOPE',
            'TaskService.list requires projectId, projectIds or workspaceId'
          )
        );
      }

      const conditions: SQL[] = [];
      if (filters.onlyDeleted) conditions.push(isNotNull(tasks.deletedAt));
      else if (!filters.includeDeleted) conditions.push(isNull(tasks.deletedAt));

      if (filters.projectId) conditions.push(eq(tasks.projectId, filters.projectId));
      if (filters.projectIds) {
        // An explicitly-empty list means "match nothing".
        conditions.push(
          filters.projectIds.length ? inArray(tasks.projectId, filters.projectIds) : sql`false`
        );
      }
      if (filters.workspaceId) conditions.push(eq(projects.workspaceId, filters.workspaceId));
      if (filters.ids)
        conditions.push(filters.ids.length ? inArray(tasks.id, filters.ids) : sql`false`);
      if (filters.stateId) conditions.push(eq(tasks.stateId, filters.stateId));
      if (filters.stateIds?.length) conditions.push(inArray(tasks.stateId, filters.stateIds));
      conditions.push(...buildTaskAssigneeConditions(filters));
      conditions.push(...buildTaskLabelConditions(filters));
      if (filters.priority) conditions.push(eq(tasks.priority, filters.priority));
      if (filters.priorities?.length) conditions.push(inArray(tasks.priority, filters.priorities));
      if (filters.createdBy) conditions.push(eq(tasks.createdBy, filters.createdBy));
      if (filters.dueBefore) conditions.push(lt(tasks.dueDate, filters.dueBefore));
      if (filters.dueAfter) conditions.push(gt(tasks.dueDate, filters.dueAfter));
      if (filters.parentId !== undefined) {
        conditions.push(
          filters.parentId === null ? isNull(tasks.parentId) : eq(tasks.parentId, filters.parentId)
        );
      }
      if (filters.search?.trim()) {
        conditions.push(this.searchCondition(filters.search));
      }
      if (filterSql) conditions.push(filterSql);

      const whereClause = and(...conditions);
      const needsAssigneeJoin = taskListNeedsAssigneeJoin(filters, requiredJoins);
      const needsLabelJoin = requiredJoins.has('task_labels');
      const distinct = needsAssigneeJoin || needsLabelJoin;

      let countQuery = this.db
        .select({ count: sql<number>`COUNT(DISTINCT ${tasks.id})::int` })
        .from(tasks)
        .leftJoin(taskStates, eq(tasks.stateId, taskStates.id))
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .$dynamic();
      if (needsAssigneeJoin)
        countQuery = countQuery.leftJoin(taskAssignees, eq(tasks.id, taskAssignees.taskId));
      if (needsLabelJoin)
        countQuery = countQuery.leftJoin(taskLabels, eq(tasks.id, taskLabels.taskId));
      const base = distinct
        ? this.db.selectDistinct(taskRowSelection)
        : this.db.select(taskRowSelection);
      let taskQuery = base
        .from(tasks)
        .leftJoin(taskStates, eq(tasks.stateId, taskStates.id))
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .leftJoin(workspaceAgents, eq(tasks.agentId, workspaceAgents.id))
        .$dynamic();
      if (needsAssigneeJoin)
        taskQuery = taskQuery.leftJoin(taskAssignees, eq(tasks.id, taskAssignees.taskId));
      if (needsLabelJoin)
        taskQuery = taskQuery.leftJoin(taskLabels, eq(tasks.id, taskLabels.taskId));

      const [countResult, rows] = await Promise.all([
        skipCount ? Promise.resolve(null) : countQuery.where(whereClause),
        taskQuery
          .where(whereClause)
          .orderBy(...this.orderBy(sortBy, sortOrder, distinct))
          .limit(limit)
          .offset((page - 1) * limit),
      ]);
      const total = countResult ? Number(countResult[0]?.count ?? 0) : rows.length;

      return ok({ tasks: await hydrateTasks(this.db, rows), total });
    } catch (error) {
      return err(toError(error));
    }
  }

  private orderBy(
    sortBy: NonNullable<TaskListOptions['sortBy']>,
    sortOrder: 'asc' | 'desc',
    distinct: boolean
  ): SQL[] {
    const dir = sortOrder === 'desc' ? desc : asc;
    switch (sortBy) {
      case 'position':
        // The column is COLLATE "C" (byte order). With DISTINCT, ORDER BY
        // expressions must be in the select list, so use the bare column.
        return distinct
          ? [dir(tasks.position), dir(tasks.id)]
          : [
              sortOrder === 'desc'
                ? sql`${tasks.position} COLLATE "C" DESC`
                : sql`${tasks.position} COLLATE "C"`,
              dir(tasks.id),
            ];
      case 'priority':
        return distinct
          ? [dir(tasks.priority), asc(tasks.id)]
          : [dir(PRIORITY_RANK), asc(tasks.id)];
      case 'created_at':
        return [dir(tasks.createdAt), asc(tasks.id)];
      case 'updated_at':
        return [dir(tasks.updatedAt), asc(tasks.id)];
      case 'due_date':
        return [
          sortOrder === 'desc'
            ? sql`${tasks.dueDate} DESC NULLS LAST`
            : sql`${tasks.dueDate} ASC NULLS LAST`,
          asc(tasks.id),
        ];
      case 'sequence_number':
        return [dir(tasks.sequenceNumber), asc(tasks.id)];
      case 'deleted_at':
        return [dir(tasks.deletedAt), asc(tasks.id)];
    }
  }

  /**
   * Search condition: full-text (tsvector) + prefix match, OR the task key
   * ("TF-12") when the query is one. Both are ANDed with the caller's
   * project/workspace scope by list(), so the key never reaches outside it
   * and whether a key exists elsewhere cannot change the result.
   */
  private searchCondition(search: string): SQL {
    const query = search.trim();
    const text = buildTextSearchCondition(query);
    const key = parseTaskKey(query);
    if (!key) return text;
    return or(buildTaskKeyCondition(key.identifier, key.sequenceNumber), text) ?? text;
  }

  /** Soft-deleted tasks of a project, newest deletion first. */
  async listTrash(
    projectId: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<Result<{ tasks: TaskWithRelations[]; total: number }, Error>> {
    return this.list({
      filters: { projectId, onlyDeleted: true },
      sortBy: 'deleted_at',
      sortOrder: 'desc',
      page: options.page,
      limit: options.limit,
    });
  }

  /** Add an assignee (validated against workspace/project access). */
  async addAssignee(
    taskId: string,
    userId: string,
    assignedBy: string | null,
    options?: { mcpClientId?: string | null }
  ): Promise<Result<void, Error>> {
    return this.changeSets(taskId, assignedBy, options?.mcpClientId, { addAssigneeIds: [userId] });
  }

  async removeAssignee(
    taskId: string,
    userId: string,
    removedBy: string | null,
    options?: { mcpClientId?: string | null }
  ): Promise<Result<void, Error>> {
    return this.changeSets(taskId, removedBy, options?.mcpClientId, {
      removeAssigneeIds: [userId],
    });
  }

  /** Add a label (must belong to the task's project). */
  async addLabel(
    taskId: string,
    labelId: string,
    addedBy: string | null
  ): Promise<Result<void, Error>> {
    return this.changeSets(taskId, addedBy, null, { addLabelIds: [labelId] });
  }

  async removeLabel(
    taskId: string,
    labelId: string,
    removedBy: string | null
  ): Promise<Result<void, Error>> {
    return this.changeSets(taskId, removedBy, null, { removeLabelIds: [labelId] });
  }

  private async changeSets(
    taskId: string,
    actorId: string | null,
    mcpClientId: string | null | undefined,
    change: {
      addAssigneeIds?: string[];
      removeAssigneeIds?: string[];
      addLabelIds?: string[];
      removeLabelIds?: string[];
    }
  ): Promise<Result<void, Error>> {
    try {
      const outcome = await this.db.transaction(async (tx) => {
        const current = await lockTask(tx, taskId);
        const project = await loadProjectScope(tx, current.projectId);
        const diff = await applySetChanges(tx, project, taskId, change);
        await recordTaskEvents(tx, this.setChangeEvents(taskId, actorId, mcpClientId, diff));
        const changed =
          diff.addedAssigneeIds.length +
            diff.removedAssigneeIds.length +
            diff.addedLabelIds.length +
            diff.removedLabelIds.length >
          0;
        if (changed)
          await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, taskId));
        return { project, diff, changed };
      });
      if (outcome.changed) {
        const task = await this.getById(taskId);
        if (task.ok) {
          this.events.emit('task.updated', {
            task: task.value,
            workspaceId: outcome.project.workspaceId,
            projectId: outcome.project.id,
            actorId,
            mcpClientId: mcpClientId ?? null,
            changes: [],
            ...outcome.diff,
          });
        }
      }
      return ok(undefined);
    } catch (error) {
      return err(toError(error));
    }
  }

  private emitRekeyed(project: ProjectScope, stateId: string | null): void {
    this.events.emit('tasks.rekeyed', {
      workspaceId: project.workspaceId,
      projectId: project.id,
      stateId,
    });
  }
}

/** Add/remove assignees and labels (validated) without touching the task row. */
export async function applySetChanges(
  tx: DbExecutor,
  project: ProjectScope,
  taskId: string,
  change: {
    addAssigneeIds?: string[];
    removeAssigneeIds?: string[];
    addLabelIds?: string[];
    removeLabelIds?: string[];
  }
): Promise<AssigneeLabelDiff> {
  const diff: AssigneeLabelDiff = {
    addedAssigneeIds: [],
    removedAssigneeIds: [],
    addedLabelIds: [],
    removedLabelIds: [],
  };
  if (change.addAssigneeIds?.length) {
    await assertAssigneesCanAccess(tx, project, change.addAssigneeIds);
    const inserted = await tx
      .insert(taskAssignees)
      .values([...new Set(change.addAssigneeIds)].map((userId) => ({ taskId, userId })))
      .onConflictDoNothing()
      .returning({ userId: taskAssignees.userId });
    diff.addedAssigneeIds = inserted.map((r) => r.userId);
  }
  if (change.removeAssigneeIds?.length) {
    const removed = await tx
      .delete(taskAssignees)
      .where(
        and(
          eq(taskAssignees.taskId, taskId),
          inArray(taskAssignees.userId, change.removeAssigneeIds)
        )
      )
      .returning({ userId: taskAssignees.userId });
    diff.removedAssigneeIds = removed.map((r) => r.userId);
  }
  if (change.addLabelIds?.length) {
    await assertLabelsInProject(tx, project.id, change.addLabelIds);
    const inserted = await tx
      .insert(taskLabels)
      .values([...new Set(change.addLabelIds)].map((labelId) => ({ taskId, labelId })))
      .onConflictDoNothing()
      .returning({ labelId: taskLabels.labelId });
    diff.addedLabelIds = inserted.map((r) => r.labelId);
  }
  if (change.removeLabelIds?.length) {
    const removed = await tx
      .delete(taskLabels)
      .where(and(eq(taskLabels.taskId, taskId), inArray(taskLabels.labelId, change.removeLabelIds)))
      .returning({ labelId: taskLabels.labelId });
    diff.removedLabelIds = removed.map((r) => r.labelId);
  }
  return diff;
}

export type { AssigneeLabelDiff };
