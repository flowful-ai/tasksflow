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
});

export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  stateId: z.string().uuid().optional(),
  priority: TaskPrioritySchema.optional(),
  dueDate: z.coerce.date().optional(),
  startDate: z.coerce.date().optional(),
  assigneeIds: z.array(z.string().uuid()).optional(),
  labelIds: z.array(z.string().uuid()).optional(),
});

export type CreateTask = z.infer<typeof CreateTaskSchema>;

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  stateId: z.string().uuid().optional(),
  priority: TaskPrioritySchema.nullable().optional(),
  position: z.string().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
});

export type UpdateTask = z.infer<typeof UpdateTaskSchema>;

export const MoveTaskSchema = z.object({
  stateId: z.string().uuid(),
  position: z.string(),
});

export type MoveTask = z.infer<typeof MoveTaskSchema>;

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
