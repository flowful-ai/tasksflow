import type { TaskWithRelations } from '@flowtask/domain';
import { UNTRUSTED_TEXT_KEY } from '@flowtask/domain';
import { ToolExecutionError } from './errors.js';
import type { JsonRecord } from './json-schema-zod.js';
import { resolveMcpTaskViewArgs, resolveMcpWriteReturnMode, type McpTaskViewArgs, type McpWriteReturnMode } from './tool-args.js';

/**
 * Tool output shaping. Outputs are serialized to JSON for the model, so they
 * are plain records. User-authored or GitHub-synced text is wrapped as
 * `{ untrusted_text: "..." }` so the model treats it as data, not instructions.
 */

export type ToolOutput = Record<string, unknown>;

export interface UntrustedText {
  [UNTRUSTED_TEXT_KEY]: string;
}

export function untrusted(value: string): UntrustedText;
export function untrusted(value: string | null): UntrustedText | null;
export function untrusted(value: string | null): UntrustedText | null {
  return value === null ? null : { [UNTRUSTED_TEXT_KEY]: value };
}

const COMPACT_TASK_FIELDS = ['id', 'key', 'projectId', 'title', 'stateId', 'priority', 'updatedAt', 'dueDate'] as const;

const TASK_CUSTOM_FIELDS = [
  'id',
  'key',
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

export type TaskProjectionOptions = McpTaskViewArgs;

function validateCustomFields(fields: string[]): void {
  const allowed = new Set<string>(TASK_CUSTOM_FIELDS);
  const invalidFields = fields.filter((field) => !allowed.has(field));
  if (invalidFields.length > 0) {
    throw new ToolExecutionError(
      `Unknown fields: ${invalidFields.join(', ')}. Allowed: ${TASK_CUSTOM_FIELDS.join(', ')}`,
      'VALIDATION_ERROR'
    );
  }
}

function validateCustomRelationFlags(fields: string[], includes: TaskProjectionOptions): void {
  for (const field of fields) {
    const requiredFlag = RELATION_FIELD_FLAGS[field];
    if (requiredFlag && !includes[requiredFlag]) {
      throw new ToolExecutionError(`${field} requires ${requiredFlag}=true`, 'VALIDATION_ERROR');
    }
  }
}

export function resolveTaskProjectionArgs(args: JsonRecord): TaskProjectionOptions {
  const viewArgs = resolveMcpTaskViewArgs(args);
  if (viewArgs.view === 'custom' && viewArgs.fields) {
    validateCustomFields(viewArgs.fields);
    validateCustomRelationFlags(viewArgs.fields, viewArgs);
  }
  return viewArgs;
}

export function resolveWriteMode(args: JsonRecord): McpWriteReturnMode {
  return resolveMcpWriteReturnMode(args);
}

export function taskKey(task: Pick<TaskWithRelations, 'project' | 'sequenceNumber'>): string {
  return `${task.project.identifier}-${task.sequenceNumber}`;
}

function summarizeUser(user: { id: string; name: string | null; email: string }) {
  return { id: user.id, name: user.name, email: user.email };
}

/** The full, model-safe representation of a task (before projection). */
function modelTask(task: TaskWithRelations): ToolOutput {
  return {
    id: task.id,
    key: taskKey(task),
    projectId: task.projectId,
    stateId: task.stateId,
    sequenceNumber: task.sequenceNumber,
    title: untrusted(task.title),
    description: untrusted(task.description),
    priority: task.priority,
    position: task.position,
    dueDate: task.dueDate,
    startDate: task.startDate,
    createdBy: task.createdBy,
    agentId: task.agentId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    deletedAt: task.deletedAt,
    state: task.state ? { id: task.state.id, name: task.state.name, category: task.state.category } : null,
    project: task.project,
    assignees: task.assignees.map(summarizeUser),
    labels: task.labels.map((label) => ({ id: label.id, name: label.name, color: label.color })),
    agent: task.agent,
    externalLinks: task.externalLinks,
  };
}

export function projectTask(task: TaskWithRelations, options: TaskProjectionOptions): ToolOutput {
  const full = modelTask(task);

  if (options.view === 'compact') {
    const compact: ToolOutput = {};
    for (const field of COMPACT_TASK_FIELDS) {
      compact[field] = full[field];
    }
    if (options.includeAssignees) compact.assignees = full.assignees;
    if (options.includeLabels) compact.labels = full.labels;
    if (options.includeExternalLinks) compact.externalLinks = full.externalLinks;
    return compact;
  }

  if (!options.includeAssignees) delete full.assignees;
  if (!options.includeLabels) delete full.labels;
  if (!options.includeExternalLinks) delete full.externalLinks;

  if (options.view === 'full') {
    return full;
  }

  const custom: ToolOutput = {};
  for (const field of options.fields ?? []) {
    custom[field] = full[field];
  }
  return custom;
}

export function projectTaskList(
  tasks: TaskWithRelations[],
  total: number,
  options: TaskProjectionOptions,
  nextCursor?: string
): { total: number; tasks: ToolOutput[]; nextCursor?: string } {
  return {
    total,
    tasks: tasks.map((task) => projectTask(task, options)),
    ...(nextCursor ? { nextCursor } : {}),
  };
}

const WRITE_PROJECTION: TaskProjectionOptions = {
  view: 'compact',
  includeAssignees: false,
  includeLabels: false,
  includeExternalLinks: false,
};

export function formatWriteTaskResult(tool: string, task: TaskWithRelations, mode: McpWriteReturnMode): ToolOutput {
  if (mode === 'ack') {
    return { ok: true, tool, id: task.id, key: taskKey(task) };
  }

  return {
    ok: true,
    tool,
    task: projectTask(
      task,
      mode === 'full'
        ? { view: 'full', includeAssignees: true, includeLabels: true, includeExternalLinks: true }
        : WRITE_PROJECTION
    ),
  };
}

export interface CommentForModel {
  id: string;
  taskId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  externalCommentId: string | null;
  user: { id: string; name: string | null; email: string } | null;
}

export function projectComment(comment: CommentForModel): ToolOutput {
  return {
    id: comment.id,
    taskId: comment.taskId,
    content: untrusted(comment.content),
    author: comment.user ? summarizeUser(comment.user) : null,
    source: comment.externalCommentId ? 'github' : 'flowtask',
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

export function formatWriteCommentResult(tool: string, comment: CommentForModel, mode: McpWriteReturnMode): ToolOutput {
  if (mode === 'ack') {
    return { ok: true, tool, id: comment.id };
  }
  return { ok: true, tool, comment: projectComment(comment) };
}

export function formatBulkCreateResult(
  tool: string,
  createdTasks: TaskWithRelations[],
  failed: Array<{ index: number; error: string }>,
  mode: McpWriteReturnMode
): ToolOutput {
  if (mode === 'ack') {
    return {
      ok: true,
      tool,
      createdIds: createdTasks.map((task) => task.id),
      failed,
    };
  }

  return {
    ok: true,
    tool,
    tasks: createdTasks.map((task) => formatWriteTaskResult(tool, task, mode).task),
    failed,
  };
}

export type { McpTaskViewArgs, McpWriteReturnMode };
