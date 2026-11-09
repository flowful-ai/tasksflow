import { z } from 'zod';
import { BaseEntitySchema } from './common.js';
import { LabelSchema, TaskStateSchema } from './project.js';
import { UserSchema } from './user.js';

export const TaskPrioritySchema = z.enum(['urgent', 'high', 'medium', 'low', 'none']);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskSchema = BaseEntitySchema.extend({
  projectId: z.string().uuid(),
  stateId: z.string().uuid().nullable(),
  sequenceNumber: z.number().int().positive(),
  title: z.string().min(1).max(500),
  description: z.string().nullable(),
  priority: TaskPrioritySchema.nullable(),
  position: z.string(),
  dueDate: z.coerce.date().nullable(),
  startDate: z.coerce.date().nullable(),
  createdBy: z.string().uuid().nullable(),
  deletedAt: z.coerce.date().nullable(),
  /** When the task entered a done-category state; null while not done. */
  completedAt: z.coerce.date().nullable().optional(),
});

export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  stateId: z.string().uuid().optional(),
  priority: TaskPrioritySchema.optional(),
  dueDate: z.coerce.date().optional(),
  startDate: z.coerce.date().optional(),
  assigneeIds: z.array(z.string().uuid()).max(50).optional(),
  labelIds: z.array(z.string().uuid()).max(50).optional(),
  /** Parent task (sub-task). Must be in the same project; cycles are rejected. */
  parentId: z.string().uuid().nullable().optional(),
  // GitHub integration: optionally create a linked GitHub issue
  createOnGitHub: z.boolean().optional(),
  githubRepo: z
    .object({
      owner: z.string(),
      repo: z.string(),
    })
    .optional(),
});

export type CreateTask = z.infer<typeof CreateTaskSchema>;

export const BulkCreateTaskItemSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  priority: TaskPrioritySchema.optional(),
  stateId: z.string().uuid().optional(),
});

export type BulkCreateTaskItem = z.infer<typeof BulkCreateTaskItemSchema>;

export const BulkCreateTasksInputSchema = z.object({
  projectId: z.string().uuid(),
  tasks: z.array(BulkCreateTaskItemSchema).min(1).max(50),
});

export type BulkCreateTasksInput = z.infer<typeof BulkCreateTasksInputSchema>;

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  stateId: z.string().uuid().optional(),
  priority: TaskPrioritySchema.nullable().optional(),
  position: z.string().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  /** Set (or clear with null) the parent task. Same project only; cycles rejected. */
  parentId: z.string().uuid().nullable().optional(),
  /** Replace the full assignee set (validated against workspace/project membership). */
  assigneeIds: z.array(z.string().uuid()).max(50).optional(),
  /** Replace the full label set (labels must belong to the task's project). */
  labelIds: z.array(z.string().uuid()).max(50).optional(),
});

export type UpdateTask = z.infer<typeof UpdateTaskSchema>;

/**
 * Move a task to a column and/or reorder it.
 *
 * Preferred: pass the neighbours the task is dropped between and let the
 * server compute the key (`afterTaskId` = the task that ends up directly
 * above, `beforeTaskId` = directly below; either may be omitted at the
 * column edges, both omitted = append to the end).
 */
export const MoveTaskSchema = z.object({
  stateId: z.string().uuid(),
  afterTaskId: z.string().uuid().nullable().optional(),
  beforeTaskId: z.string().uuid().nullable().optional(),
});

export type MoveTask = z.infer<typeof MoveTaskSchema>;

export const LinkTaskGitHubPrSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.coerce.number().int().positive(),
});

export type LinkTaskGitHubPr = z.infer<typeof LinkTaskGitHubPrSchema>;

// Task with relations
export const TaskWithRelationsSchema = TaskSchema.extend({
  state: TaskStateSchema.nullable(),
  assignees: z.array(UserSchema),
  labels: z.array(LabelSchema),
});

export type TaskWithRelations = z.infer<typeof TaskWithRelationsSchema>;

// Task events
export const TaskEventTypeSchema = z.enum([
  'created',
  'updated',
  'moved',
  'assigned',
  'unassigned',
  'labeled',
  'unlabeled',
  'commented',
  'deleted',
  'restored',
  'relation_added',
  'relation_removed',
]);
export type TaskEventType = z.infer<typeof TaskEventTypeSchema>;

export const TaskEventSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  eventType: TaskEventTypeSchema,
  fieldName: z.string().nullable(),
  oldValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  createdAt: z.coerce.date(),
});

export type TaskEvent = z.infer<typeof TaskEventSchema>;

// Comments
export const CommentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  content: z.string().min(1),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date().nullable(),
  deletedAt: z.coerce.date().nullable(),
});

export type Comment = z.infer<typeof CommentSchema>;

export const CreateCommentSchema = z.object({
  content: z.string().min(1),
});

export type CreateComment = z.infer<typeof CreateCommentSchema>;

export const UpdateCommentSchema = z.object({
  content: z.string().min(1),
});

export type UpdateComment = z.infer<typeof UpdateCommentSchema>;

// ============ Task relations ============

export const TaskRelationTypeSchema = z.enum(['blocks', 'relates', 'duplicates']);
export type TaskRelationType = z.infer<typeof TaskRelationTypeSchema>;

/**
 * Relation as seen from one task. `blocks`/`duplicates` are directional:
 * `direction: 'outgoing'` means "this task blocks/duplicates `task`",
 * `'incoming'` means "`task` blocks/duplicates this task". `relates` is
 * symmetric and always reported as 'outgoing'.
 */
export const AddTaskRelationSchema = z.object({
  relatedTaskId: z.string().uuid(),
  type: TaskRelationTypeSchema,
  /** For 'blocks'/'duplicates': 'outgoing' (default) = this task → related, 'incoming' = related → this task. */
  direction: z.enum(['outgoing', 'incoming']).default('outgoing'),
});
export type AddTaskRelation = z.infer<typeof AddTaskRelationSchema>;

// ============ Bulk operations ============

export const BULK_TASK_LIMIT = 200;

export const BulkTaskOperationSchema = z
  .object({
    stateId: z.string().uuid().optional(),
    priority: TaskPrioritySchema.nullable().optional(),
    addAssigneeIds: z.array(z.string().uuid()).max(50).optional(),
    removeAssigneeIds: z.array(z.string().uuid()).max(50).optional(),
    addLabelIds: z.array(z.string().uuid()).max(50).optional(),
    removeLabelIds: z.array(z.string().uuid()).max(50).optional(),
    delete: z.boolean().optional(),
    restore: z.boolean().optional(),
  })
  .refine((op) => !(op.delete && op.restore), {
    message: 'delete and restore are mutually exclusive',
  })
  .refine(
    (op) =>
      op.stateId !== undefined ||
      op.priority !== undefined ||
      Boolean(op.addAssigneeIds?.length) ||
      Boolean(op.removeAssigneeIds?.length) ||
      Boolean(op.addLabelIds?.length) ||
      Boolean(op.removeLabelIds?.length) ||
      op.delete === true ||
      op.restore === true,
    { message: 'op must change at least one thing' }
  );
export type BulkTaskOperation = z.infer<typeof BulkTaskOperationSchema>;

export const BulkTaskRequestSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(BULK_TASK_LIMIT),
  op: BulkTaskOperationSchema,
});
export type BulkTaskRequest = z.infer<typeof BulkTaskRequestSchema>;

export type BulkTaskResultStatus = 'updated' | 'unchanged' | 'not_found' | 'forbidden' | 'invalid';

export interface BulkTaskItemResult {
  taskId: string;
  status: BulkTaskResultStatus;
  /** Error code when status is not updated/unchanged (e.g. INVALID_STATE, INVALID_ASSIGNEE). */
  code?: string;
  message?: string;
}

// ============ History ============

export const TaskHistoryQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type TaskHistoryQuery = z.infer<typeof TaskHistoryQuerySchema>;

// ============ Trash ============

export const TrashQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type TrashQuery = z.infer<typeof TrashQuerySchema>;

/** Days a soft-deleted task stays in the trash before the purge job hard-deletes it. */
export const TRASH_RETENTION_DAYS = 30;
