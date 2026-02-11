import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

export const WorkspaceRoleSchema = z.enum(['owner', 'admin', 'member']);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const WorkspaceSchema = BaseEntitySchema.extend({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens',
  }),
});

export type CreateWorkspace = z.infer<typeof CreateWorkspaceSchema>;

export const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

export type UpdateWorkspace = z.infer<typeof UpdateWorkspaceSchema>;

export const WorkspaceMemberSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  role: WorkspaceRoleSchema,
  createdAt: z.coerce.date(),
});

export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

export const WorkspaceWithMembersSchema = WorkspaceSchema.extend({
  members: z.array(WorkspaceMemberSchema),
});

export type WorkspaceWithMembers = z.infer<typeof WorkspaceWithMembersSchema>;

export const WorkspaceActivityEventTypeSchema = z.enum([
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
export type WorkspaceActivityEventType = z.infer<typeof WorkspaceActivityEventTypeSchema>;

export const WorkspaceActivityCursorSchema = z.object({
  createdAt: z.coerce.date(),
  id: z.string().uuid(),
});
export type WorkspaceActivityCursor = z.infer<typeof WorkspaceActivityCursorSchema>;

export const WorkspaceActivityItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.coerce.date(),
  eventType: WorkspaceActivityEventTypeSchema,
  fieldName: z.string().nullable(),
  task: z.object({
    id: z.string().uuid(),
    title: z.string(),
    sequenceNumber: z.number().int().positive(),
    project: z.object({
      id: z.string().uuid(),
      identifier: z.string(),
      name: z.string(),
    }),
  }),
  actor: z.object({
    id: z.string().uuid(),
    name: z.string().nullable(),
    email: z.string().email(),
  }).nullable(),
  agent: z.object({
    id: z.string(),
    name: z.string(),
  }).nullable(),
});
export type WorkspaceActivityItem = z.infer<typeof WorkspaceActivityItemSchema>;

export const WorkspaceActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type WorkspaceActivityQuery = z.infer<typeof WorkspaceActivityQuerySchema>;
