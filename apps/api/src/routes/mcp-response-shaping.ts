import type { TaskWithRelations } from '@flowtask/domain';
import type { McpTaskView, McpWriteReturnMode } from './mcp-tool-args.js';
import { resolveMcpLimit, resolveMcpTaskViewArgs, resolveMcpWriteReturnMode } from './mcp-tool-args.js';

const COMPACT_TASK_FIELDS = [
  'id',
  'projectId',
  'title',
  'stateId',
  'priority',
  'updatedAt',
  'dueDate',
] as const;

const TASK_CUSTOM_FIELDS = [
  'id',
  'projectId',
  'stateId',
  'sequenceNumber',
  'title',
  'description',
  'priority',
  'position',
  'dueDate',
  'startDate',
  'createdBy',
  'agentId',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'state',
  'project',
  'assignees',
  'labels',
  'agent',
  'externalLinks',
] as const;

const RELATION_FIELD_FLAGS: Record<string, 'includeAssignees' | 'includeLabels' | 'includeExternalLinks' | null> = {
  assignees: 'includeAssignees',
  labels: 'includeLabels',
  externalLinks: 'includeExternalLinks',
  state: null,
  project: null,
  agent: null,
};

export type TaskProjectionOptions = ReturnType<typeof resolveTaskProjectionArgs>;

type ProjectedTask = Record<string, unknown>;

function validateCustomFields(fields: string[]): void {
  const allowed = new Set<string>(TASK_CUSTOM_FIELDS);
  const invalidFields = fields.filter((field) => !allowed.has(field));
  if (invalidFields.length > 0) {
    throw new Error(`Unknown fields: ${invalidFields.join(', ')}`);
  }
}

function validateCustomRelationFlags(
  fields: string[],
  includes: Pick<TaskProjectionOptions, 'includeAssignees' | 'includeLabels' | 'includeExternalLinks'>
): void {
  for (const field of fields) {
    const requiredFlag = RELATION_FIELD_FLAGS[field];
    if (!requiredFlag) {
      continue;
    }
    if (!includes[requiredFlag]) {
      throw new Error(`${field} requires ${requiredFlag}=true`);
    }
  }
}

export function resolveTaskProjectionArgs(args: Record<string, unknown>) {
  const viewArgs = resolveMcpTaskViewArgs(args);
  if (viewArgs.view === 'custom' && viewArgs.fields) {
    validateCustomFields(viewArgs.fields);
    validateCustomRelationFlags(viewArgs.fields, viewArgs);
  }
  return viewArgs;
}

export function resolveWriteMode(args: Record<string, unknown>): McpWriteReturnMode {
  return resolveMcpWriteReturnMode(args);
}

export function resolveListLimit(args: Record<string, unknown>): number {
  return resolveMcpLimit(args, { defaultLimit: 10, maxLimit: 50 });
}

function relationAwareTask(task: TaskWithRelations, options: TaskProjectionOptions): ProjectedTask {
  const result: ProjectedTask = {
    ...task,
  };

  if (!options.includeAssignees) {
    delete result.assignees;
  }

  if (!options.includeLabels) {
    delete result.labels;
  }

  if (!options.includeExternalLinks) {
    delete result.externalLinks;
  }

  return result;
}

export function projectTask(task: TaskWithRelations, options: TaskProjectionOptions): ProjectedTask {
  if (options.view === 'compact') {
    const compact = {} as ProjectedTask;
    for (const field of COMPACT_TASK_FIELDS) {
      compact[field] = task[field];
    }

    if (options.includeAssignees) {
      compact.assignees = task.assignees;
    }
    if (options.includeLabels) {
      compact.labels = task.labels;
    }
    if (options.includeExternalLinks) {
      compact.externalLinks = task.externalLinks;
    }

    return compact;
  }

  const normalized = relationAwareTask(task, options);

  if (options.view === 'full') {
    return normalized;
  }

  const custom = {} as ProjectedTask;
  for (const field of options.fields ?? []) {
    custom[field] = normalized[field];
  }
  return custom;
}

export function projectTaskList(
  tasks: TaskWithRelations[],
  total: number,
  options: TaskProjectionOptions
): { total: number; tasks: ProjectedTask[] } {
  return {
    total,
    tasks: tasks.map((task) => projectTask(task, options)),
  };
}

export function formatWriteTaskResult(
  tool: string,
  task: TaskWithRelations,
  mode: McpWriteReturnMode,
  projection: TaskProjectionOptions
): Record<string, unknown> {
  if (mode === 'ack') {
    return { ok: true, tool, id: task.id };
  }

  const view = mode === 'full' ? 'full' : 'compact';
  return {
    ok: true,
    tool,
    task: projectTask(task, { ...projection, view, fields: undefined }),
  };
}

export function formatWriteCommentResult(
  tool: string,
  commentId: string,
  comment: unknown,
  mode: McpWriteReturnMode
): Record<string, unknown> {
  if (mode === 'ack') {
    return { ok: true, tool, id: commentId };
  }

  return {
    ok: true,
    tool,
    comment,
  };
}

export function formatBulkCreateResult(
  tool: string,
  createdTasks: TaskWithRelations[],
  failed: Array<{ index: number; error: string }>,
  mode: McpWriteReturnMode,
  projection: TaskProjectionOptions
): Record<string, unknown> {
  if (mode === 'ack') {
    return {
      ok: true,
      tool,
      createdIds: createdTasks.map((task) => task.id),
      failed,
    };
  }

  const view = mode === 'full' ? 'full' : 'compact';
  return {
    ok: true,
    tool,
    tasks: createdTasks.map((task) => projectTask(task, { ...projection, view, fields: undefined })),
    failed,
  };
}

export type { McpTaskView, McpWriteReturnMode };
