import type { TaskFilters, TaskRelationView, TaskWithRelations } from '../../domain/index.js';
import type { Result, TaskRelationType } from '@flowtask/shared';
import { ToolExecutionError, fromDomainError, toToolErrorPayload } from '../../lib/mcp/errors.js';
import type { ToolContext } from '../../lib/mcp/tool-context.js';
import type { JsonRecord } from '../../lib/mcp/json-schema-zod.js';
import {
  nullableString,
  optionalBoolean,
  optionalPriority,
  optionalRecordArray,
  optionalString,
  optionalStringArray,
  optionalInteger,
  parseDueDate,
  requiredString,
  resolveMcpWriteReturnMode,
  resolveUpdateTaskGitHubPrArgs,
} from '../../lib/mcp/tool-args.js';
import {
  formatBulkCreateResult,
  formatWriteTaskResult,
  projectRelation,
  projectTask,
  projectTaskList,
  resolveTaskProjectionArgs,
  type ToolOutput,
} from '../../lib/mcp/response-shaping.js';
import { nextCursorFor, pageNumber, resolvePageWindow } from '../../lib/mcp/cursor.js';
import { TaskGitHubLinkError } from '../task-github-link-service.js';
import type { ToolHandler, ToolServices } from './types.js';

export function unwrap<T>(result: Result<T, Error>): T {
  if (!result.ok) {
    throw fromDomainError(result.error);
  }
  return result.value;
}

async function reloadTask(services: ToolServices, taskId: string): Promise<TaskWithRelations> {
  return unwrap(await services.tasks.getById(taskId));
}

/**
 * Resolves user refs to member ids and enforces task:assign when anyone other
 * than the caller is being assigned (members may still assign themselves).
 */
async function resolveAssigneeIds(ctx: ToolContext, refs: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const ref of refs) {
    const member = await ctx.resolveUser(ref);
    if (!ids.includes(member.id)) {
      ids.push(member.id);
    }
  }
  if (ids.some((id) => id !== ctx.userId)) {
    ctx.assertPermission('task:assign');
  }
  return ids;
}

// ---------- create ----------

interface CreateFields {
  title: string;
  description?: string;
  priority?: ReturnType<typeof optionalPriority>;
  stateId?: string;
  parentId?: string;
  dueDate?: Date;
  labelIds?: string[];
  assigneeIds?: string[];
}

/** Resolves a task ref through the context, so a parent or related task the caller cannot see is not found. */
async function resolveTaskId(ctx: ToolContext, ref: string): Promise<string> {
  return (await ctx.requireTask(ref)).id;
}

async function readCreateFields(
  item: JsonRecord,
  ctx: ToolContext,
  extraAssignees: string[] = []
): Promise<CreateFields> {
  const dueDate = optionalString(item, 'dueDate');
  const assigneeRefs = [...(optionalStringArray(item, 'assigneeIds') ?? []), ...extraAssignees];
  const parentRef = optionalString(item, 'parentId');
  return {
    title: requiredString(item, 'title'),
    description: optionalString(item, 'description'),
    priority: optionalPriority(item),
    stateId: optionalString(item, 'stateId'),
    // TaskService.create checks the parent is a live task of the same project.
    parentId: parentRef ? await resolveTaskId(ctx, parentRef) : undefined,
    dueDate: dueDate ? parseDueDate(dueDate) : undefined,
    labelIds: optionalStringArray(item, 'labelIds'),
    assigneeIds: assigneeRefs.length > 0 ? await resolveAssigneeIds(ctx, assigneeRefs) : undefined,
  };
}

const createTask: ToolHandler = async (args, ctx, services) => {
  const project = await ctx.requireProject(requiredString(args, 'projectId'));
  const fields = await readCreateFields(
    args,
    ctx,
    optionalBoolean(args, 'autoAssign') ? ['me'] : []
  );
  const mode = resolveMcpWriteReturnMode(args);

  const task = unwrap(
    await services.tasks.create({
      projectId: project.id,
      ...fields,
      createdBy: ctx.userId,
      mcpClientId: ctx.mcpClientId,
    })
  );

  return formatWriteTaskResult('create_task', task, mode);
};

const bulkCreateTasks: ToolHandler = async (args, ctx, services) => {
  const project = await ctx.requireProject(requiredString(args, 'projectId'));
  const items = optionalRecordArray(args, 'tasks') ?? [];
  const mode = resolveMcpWriteReturnMode(args);
  const created: TaskWithRelations[] = [];
  const failed: Array<{ index: number; error: string }> = [];

  for (const [index, item] of items.entries()) {
    try {
      const fields = await readCreateFields(item, ctx);
      const task = unwrap(
        await services.tasks.create({
          projectId: project.id,
          ...fields,
          createdBy: ctx.userId,
          mcpClientId: ctx.mcpClientId,
        })
      );
      created.push(task);
    } catch (error) {
      failed.push({ index, error: toToolErrorPayload(error, 'bulk_create_tasks').message });
    }
  }

  return formatBulkCreateResult('bulk_create_tasks', created, failed, mode);
};

// ---------- update ----------

async function syncLabels(
  task: TaskWithRelations,
  labelIds: string[],
  ctx: ToolContext,
  services: ToolServices
) {
  const current = new Set(task.labels.map((label) => label.id));
  const next = new Set(labelIds);
  for (const labelId of next) {
    if (!current.has(labelId)) unwrap(await services.tasks.addLabel(task.id, labelId, ctx.userId));
  }
  for (const labelId of current) {
    if (!next.has(labelId)) unwrap(await services.tasks.removeLabel(task.id, labelId, ctx.userId));
  }
}

async function syncAssignees(
  task: TaskWithRelations,
  refs: string[],
  ctx: ToolContext,
  services: ToolServices
) {
  const nextIds = new Set<string>();
  for (const ref of refs) {
    nextIds.add((await ctx.resolveUser(ref)).id);
  }
  const currentIds = new Set(task.assignees.map((user) => user.id));
  const toAdd = [...nextIds].filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !nextIds.has(id));
  if ([...toAdd, ...toRemove].some((id) => id !== ctx.userId)) {
    ctx.assertPermission('task:assign');
  }
  const options = { mcpClientId: ctx.mcpClientId };
  for (const id of toAdd)
    unwrap(await services.tasks.addAssignee(task.id, id, ctx.userId, options));
  for (const id of toRemove)
    unwrap(await services.tasks.removeAssignee(task.id, id, ctx.userId, options));
}

/**
 * Applies one update (scalar fields, labels, assignees) atomically; shared by
 * update_task and bulk_update_tasks.
 */
async function applyTaskUpdate(
  item: JsonRecord,
  ctx: ToolContext,
  outer: ToolServices
): Promise<{ before: TaskWithRelations; after: TaskWithRelations }> {
  const task = await ctx.requireTask(requiredString(item, 'taskId'));
  return outer.withTaskTransaction((tasks) =>
    applyTaskUpdateIn(task, item, ctx, { ...outer, tasks })
  );
}

async function applyTaskUpdateIn(
  task: TaskWithRelations,
  item: JsonRecord,
  ctx: ToolContext,
  services: ToolServices
): Promise<{ before: TaskWithRelations; after: TaskWithRelations }> {
  const rawDueDate = nullableString(item, 'dueDate');
  const parentRef = nullableString(item, 'parentId');
  const scalar = {
    title: optionalString(item, 'title'),
    description: optionalString(item, 'description'),
    priority: optionalPriority(item),
    stateId: optionalString(item, 'stateId'),
    // null detaches; TaskService.update rejects other projects and cycles.
    parentId:
      parentRef === undefined || parentRef === null
        ? parentRef
        : await resolveTaskId(ctx, parentRef),
    dueDate:
      rawDueDate === undefined ? undefined : rawDueDate === null ? null : parseDueDate(rawDueDate),
  };
  const hasScalarChange = Object.values(scalar).some((value) => value !== undefined);

  if (hasScalarChange) {
    unwrap(
      await services.tasks.update(task.id, {
        ...scalar,
        updatedBy: ctx.userId,
        mcpClientId: ctx.mcpClientId,
      })
    );
  }

  const labelIds = optionalStringArray(item, 'labelIds');
  if (labelIds) {
    await syncLabels(task, labelIds, ctx, services);
  }

  const assigneeRefs = optionalStringArray(item, 'assigneeIds');
  if (assigneeRefs) {
    await syncAssignees(task, assigneeRefs, ctx, services);
  }

  return { before: task, after: await reloadTask(services, task.id) };
}

const updateTask: ToolHandler = async (args, ctx, services) => {
  const prLink = resolveUpdateTaskGitHubPrArgs(args);
  const mode = resolveMcpWriteReturnMode(args);
  let { after } = await applyTaskUpdate(args, ctx, services);

  if (prLink) {
    try {
      await services.githubLinks.linkPr({
        taskId: after.id,
        projectId: after.projectId,
        actorId: ctx.userId,
        owner: prLink.owner,
        repo: prLink.repo,
        prNumber: prLink.prNumber,
      });
    } catch (error) {
      if (error instanceof TaskGitHubLinkError) {
        throw new ToolExecutionError(error.message, 'GITHUB_ERROR');
      }
      throw error;
    }
    after = await reloadTask(services, after.id);
  }

  return formatWriteTaskResult('update_task', after, mode);
};

const bulkUpdateTasks: ToolHandler = async (args, ctx, services) => {
  const updates = optionalRecordArray(args, 'updates') ?? [];
  const results: ToolOutput[] = [];
  let updated = 0;

  // One transaction per item (an item's fields, labels and assignees land
  // together), reported per task so the model can retry only what failed.
  for (const item of updates) {
    const taskRef = optionalString(item, 'taskId') ?? '';
    try {
      const { after } = await applyTaskUpdate(item, ctx, services);
      results.push({ taskId: taskRef, ok: true, id: after.id });
      updated += 1;
    } catch (error) {
      results.push({
        taskId: taskRef,
        ok: false,
        error: toToolErrorPayload(error, 'bulk_update_tasks').message,
      });
    }
  }

  return {
    ok: updated === updates.length,
    tool: 'bulk_update_tasks',
    updated,
    failed: updates.length - updated,
    results,
  };
};

const deleteTask: ToolHandler = async (args, ctx, services) => {
  const task = await ctx.requireTask(requiredString(args, 'taskId'));
  unwrap(await services.tasks.delete(task.id, ctx.userId, { mcpClientId: ctx.mcpClientId }));
  return { deleted: true, taskId: task.id };
};

// ---------- move ----------

async function resolveTargetState(task: TaskWithRelations, args: JsonRecord, ctx: ToolContext) {
  const project = await ctx.requireProject(task.projectId);
  const states = [...project.taskStates].sort((a, b) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : 0
  );
  const stateId = optionalString(args, 'stateId');
  const stateRef = optionalString(args, 'state')?.trim();
  const available = states.map((state) => `${state.name} (${state.category})`).join(', ');

  if (stateId) {
    const state = states.find((candidate) => candidate.id === stateId);
    if (!state) {
      throw new ToolExecutionError(
        `stateId does not belong to the task's project. Available: ${available}`,
        'VALIDATION_ERROR'
      );
    }
    return state;
  }

  if (stateRef) {
    const needle = stateRef.toLowerCase();
    const normalizedCategory = needle.replace(/[\s-]+/g, '_');
    const state =
      states.find((candidate) => candidate.name.toLowerCase() === needle) ??
      states.find((candidate) => candidate.category === normalizedCategory);
    if (!state) {
      throw new ToolExecutionError(
        `No state named or categorised "${stateRef}". Available: ${available}`,
        'VALIDATION_ERROR'
      );
    }
    return state;
  }

  throw new ToolExecutionError(
    'Provide stateId or state (a state name or category)',
    'VALIDATION_ERROR'
  );
}

const moveTask: ToolHandler = async (args, ctx, services) => {
  const task = await ctx.requireTask(requiredString(args, 'taskId'));
  const state = await resolveTargetState(task, args, ctx);
  const mode = resolveMcpWriteReturnMode(args);

  // No position or neighbour: TaskService appends to the end of the target
  // column under the column lock, so concurrent moves get distinct keys.
  const moved = unwrap(
    await services.tasks.move(task.id, {
      stateId: state.id,
      movedBy: ctx.userId,
      mcpClientId: ctx.mcpClientId,
    })
  );

  return formatWriteTaskResult('move_task', moved, mode);
};

const assignTask: ToolHandler = async (args, ctx, services) => {
  const task = await ctx.requireTask(requiredString(args, 'taskId'));
  const member = await ctx.resolveUser(requiredString(args, 'userId'));
  const action = requiredString(args, 'action');
  const mode = resolveMcpWriteReturnMode(args);
  const options = { mcpClientId: ctx.mcpClientId };

  if (action === 'assign') {
    unwrap(await services.tasks.addAssignee(task.id, member.id, ctx.userId, options));
  } else if (action === 'unassign') {
    unwrap(await services.tasks.removeAssignee(task.id, member.id, ctx.userId, options));
  } else {
    throw new ToolExecutionError('action must be assign or unassign', 'VALIDATION_ERROR');
  }

  const updated = await reloadTask(services, task.id);
  return formatWriteTaskResult('assign_task', updated, mode);
};

// ---------- read ----------

async function scopedProjectIds(args: JsonRecord, ctx: ToolContext): Promise<string[]> {
  const projectId = optionalString(args, 'projectId');
  if (projectId) {
    return [(await ctx.requireProject(projectId)).id];
  }
  return ctx.accessibleProjectIds();
}

async function listScopedTasks(
  args: JsonRecord,
  ctx: ToolContext,
  services: ToolServices,
  extra: Pick<TaskFilters, 'search'>
): Promise<ToolOutput> {
  const projection = resolveTaskProjectionArgs(args);
  const window = resolvePageWindow({
    limit: optionalInteger(args, 'limit'),
    cursor: optionalString(args, 'cursor'),
  });
  // Never omit projectIds: without it TaskService.list spans every workspace.
  const projectIds = await scopedProjectIds(args, ctx);
  if (projectIds.length === 0) {
    return projectTaskList([], 0, projection);
  }

  const assigneeRef = optionalString(args, 'assigneeId');
  const parentRef = optionalString(args, 'parentId')?.trim();
  const parentFilter: Pick<TaskFilters, 'parentId'> =
    parentRef === undefined
      ? {}
      : {
          parentId: parentRef.toLowerCase() === 'none' ? null : await resolveTaskId(ctx, parentRef),
        };
  const result = unwrap(
    await services.tasks.list({
      filters: {
        projectIds,
        stateId: optionalString(args, 'stateId'),
        priority: optionalPriority(args),
        assigneeId: assigneeRef ? (await ctx.resolveUser(assigneeRef)).id : undefined,
        search: optionalString(args, 'search'),
        labelId: optionalString(args, 'labelId'),
        ...parentFilter,
        ...extra,
      },
      sortBy: 'updated_at',
      sortOrder: 'desc',
      page: pageNumber(window),
      limit: window.limit,
    })
  );

  return projectTaskList(
    result.tasks,
    result.total,
    projection,
    nextCursorFor(window, result.total)
  );
}

const queryTasks: ToolHandler = (args, ctx, services) => listScopedTasks(args, ctx, services, {});

const searchTasks: ToolHandler = (args, ctx, services) =>
  listScopedTasks(args, ctx, services, { search: requiredString(args, 'query') });

/** Relations of a task, without those to tasks in projects the caller cannot see (like the REST list). */
async function visibleRelations(
  taskId: string,
  ctx: ToolContext,
  services: ToolServices
): Promise<TaskRelationView[]> {
  const relations = unwrap(await services.relations.list(taskId));
  const projectIds = new Set(await ctx.accessibleProjectIds());
  return relations.filter((relation) => projectIds.has(relation.task.projectId));
}

const getTask: ToolHandler = async (args, ctx, services) => {
  const projection = resolveTaskProjectionArgs(args);
  const task = await ctx.requireTask(requiredString(args, 'taskId'));
  const wantsRelations =
    projection.view === 'full' ||
    (projection.view === 'custom' && (projection.fields ?? []).includes('relations'));
  const relations = wantsRelations ? await visibleRelations(task.id, ctx, services) : undefined;
  return { task: projectTask({ ...task, relations }, projection) };
};

// ---------- relations ----------

const RELATION_TYPES: readonly TaskRelationType[] = ['blocks', 'relates', 'duplicates'];
type RelationDirection = TaskRelationView['direction'];
const RELATION_DIRECTIONS: readonly RelationDirection[] = ['outgoing', 'incoming'];

function optionalRelationType(args: JsonRecord): TaskRelationType | undefined {
  const value = optionalString(args, 'type');
  if (value === undefined) return undefined;
  const match = RELATION_TYPES.find((type) => type === value);
  if (!match) {
    throw new ToolExecutionError(
      `type must be one of ${RELATION_TYPES.join(', ')}`,
      'VALIDATION_ERROR'
    );
  }
  return match;
}

function optionalDirection(args: JsonRecord): RelationDirection | undefined {
  const value = optionalString(args, 'direction');
  if (value === undefined) return undefined;
  const match = RELATION_DIRECTIONS.find((direction) => direction === value);
  if (!match) {
    throw new ToolExecutionError('direction must be outgoing or incoming', 'VALIDATION_ERROR');
  }
  return match;
}

const linkTasks: ToolHandler = async (args, ctx, services) => {
  const task = await ctx.requireTask(requiredString(args, 'taskId'));
  const related = await ctx.requireTask(requiredString(args, 'relatedTaskId'));
  const type = optionalRelationType(args);
  if (!type) {
    throw new ToolExecutionError('type is required', 'VALIDATION_ERROR');
  }
  const relation = unwrap(
    await services.relations.add({
      taskId: task.id,
      relatedTaskId: related.id,
      type,
      direction: optionalDirection(args),
      createdBy: ctx.userId,
      mcpClientId: ctx.mcpClientId,
    })
  );
  return { ok: true, tool: 'link_tasks', relation: projectRelation(relation) };
};

async function findRelation(
  args: JsonRecord,
  taskId: string,
  ctx: ToolContext,
  services: ToolServices
): Promise<TaskRelationView> {
  // Only relations whose other task the caller can see, as when it is named by relatedTaskId.
  const relations = await visibleRelations(taskId, ctx, services);
  const relationId = optionalString(args, 'relationId');
  const relatedRef = optionalString(args, 'relatedTaskId');

  if (relationId) {
    const relation = relations.find((candidate) => candidate.id === relationId);
    if (!relation) {
      throw new ToolExecutionError('Relation not found', 'NOT_FOUND');
    }
    return relation;
  }

  const type = optionalRelationType(args);
  if (!relatedRef || !type) {
    throw new ToolExecutionError(
      'Provide relationId, or relatedTaskId and type',
      'VALIDATION_ERROR'
    );
  }
  const relatedId = await resolveTaskId(ctx, relatedRef);
  const direction = optionalDirection(args);
  const matches = relations.filter(
    (candidate) =>
      candidate.task.id === relatedId &&
      candidate.type === type &&
      (!direction || candidate.direction === direction)
  );
  const [match, ...others] = matches;
  if (!match) {
    throw new ToolExecutionError(`No ${type} relation between these tasks`, 'NOT_FOUND');
  }
  if (others.length > 0) {
    throw new ToolExecutionError(
      `Both directions of ${type} exist; pass direction or relationId`,
      'VALIDATION_ERROR'
    );
  }
  return match;
}

const unlinkTasks: ToolHandler = async (args, ctx, services) => {
  const task = await ctx.requireTask(requiredString(args, 'taskId'));
  const relation = await findRelation(args, task.id, ctx, services);
  unwrap(
    await services.relations.remove(task.id, relation.id, ctx.userId, {
      mcpClientId: ctx.mcpClientId,
    })
  );
  return { ok: true, tool: 'unlink_tasks', relationId: relation.id };
};

export const TASK_TOOL_HANDLERS = {
  create_task: createTask,
  bulk_create_tasks: bulkCreateTasks,
  update_task: updateTask,
  bulk_update_tasks: bulkUpdateTasks,
  delete_task: deleteTask,
  move_task: moveTask,
  assign_task: assignTask,
  query_tasks: queryTasks,
  search_tasks: searchTasks,
  get_task: getTask,
  link_tasks: linkTasks,
  unlink_tasks: unlinkTasks,
} satisfies Record<string, ToolHandler>;
