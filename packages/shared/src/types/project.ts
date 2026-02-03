import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

export const ProjectSchema = BaseEntitySchema.extend({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  identifier: z.string().min(1).max(10).regex(/^[A-Z]+$/),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  isArchived: z.boolean().default(false),
  createdBy: z.string().uuid().nullable(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  identifier: z.string().min(1).max(10).regex(/^[A-Z]+$/, {
    message: 'Identifier must contain only uppercase letters',
  }),
  description: z.string().optional(),
  icon: z.string().optional(),
});

export type CreateProject = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  isArchived: z.boolean().optional(),
});

export type UpdateProject = z.infer<typeof UpdateProjectSchema>;

// Task States
export const TaskStateCategorySchema = z.enum(['backlog', 'in_progress', 'done']);
export type TaskStateCategory = z.infer<typeof TaskStateCategorySchema>;

export const TaskStateSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1).max(50),
  category: TaskStateCategorySchema,
  position: z.string(),
  color: z.string().nullable(),
});

export type TaskState = z.infer<typeof TaskStateSchema>;

export const CreateTaskStateSchema = z.object({
  name: z.string().min(1).max(50),
  category: TaskStateCategorySchema,
  color: z.string().optional(),
});

export type CreateTaskState = z.infer<typeof CreateTaskStateSchema>;

// Labels
export const LabelSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1).max(50),
  color: z.string().nullable(),
});

export type Label = z.infer<typeof LabelSchema>;

export const CreateLabelSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().optional(),
});

export type CreateLabel = z.infer<typeof CreateLabelSchema>;
