import { z } from 'zod';
import { WorkspaceRoleSchema } from './workspace.js';

export const InvitationStatusSchema = z.enum(['pending', 'accepted', 'revoked', 'exhausted']);
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;

export const InvitationRoleSchema = z.enum(['admin', 'member']);
export type InvitationRole = z.infer<typeof InvitationRoleSchema>;

export const CreateInvitationSchema = z.object({
  email: z.string().email().optional().nullable(),
  role: InvitationRoleSchema.default('member'),
  maxUses: z.number().int().positive().optional().nullable(), // null = unlimited
});

export type CreateInvitation = z.infer<typeof CreateInvitationSchema>;

export const WorkspaceInvitationSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  email: z.string().email().nullable(), // nullable for generic links
  role: WorkspaceRoleSchema,
  token: z.string().uuid(),
  status: InvitationStatusSchema,
  maxUses: z.number().int().positive().nullable(), // null = unlimited
  usesCount: z.number().int().nonnegative(),
  expiresAt: z.coerce.date(),
  acceptedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  invitedBy: z.object({
    id: z.string().uuid(),
    name: z.string().nullable(),
    email: z.string().email(),
  }).nullable(),
});

export type WorkspaceInvitation = z.infer<typeof WorkspaceInvitationSchema>;

export const PublicInvitationSchema = z.object({
  id: z.string().uuid(),
  workspaceName: z.string(),
  email: z.string().email().nullable(), // nullable for generic links
  role: WorkspaceRoleSchema,
  isGeneric: z.boolean(), // true when email is null
  maxUses: z.number().int().positive().nullable(),
  usesCount: z.number().int().nonnegative(),
  expiresAt: z.coerce.date(),
  invitedBy: z.object({
    name: z.string().nullable(),
    email: z.string().email(),
  }).nullable(),
});

export type PublicInvitation = z.infer<typeof PublicInvitationSchema>;
