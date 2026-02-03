import { z } from 'zod';
import { AgentToolSchema } from './agent.js';
import { BaseEntitySchema } from './common.js';

// Token format constants
export const API_TOKEN_PREFIX = 'ft_v1_'; // Versioned format
export const TOKEN_PREFIX_LENGTH = 12; // Characters after ft_v1_ used for lookup

// Token format: ft_v1_<base64url-44-chars>
// Total: 50 chars (6 prefix + 44 base64url = 33 bytes = 264 bits entropy)
export const TOKEN_REGEX = /^ft_v1_[A-Za-z0-9_-]{44}$/;

// Reuse agent tool schema for permissions
export const ApiTokenPermissionSchema = AgentToolSchema;
export type ApiTokenPermission = z.infer<typeof ApiTokenPermissionSchema>;

// Workspace Agent schema (for responses - never includes token hash)
export const WorkspaceAgentSchema = BaseEntitySchema.extend({
  workspaceId: z.string().uuid(),
  restrictedProjectIds: z.array(z.string().uuid()).nullable(), // null = all projects
  name: z.string().min(1).max(100),
  description: z.string().nullable(),
  tokenPrefix: z.string().length(TOKEN_PREFIX_LENGTH),
  lastUsedAt: z.coerce.date().nullable(),
  permissions: z.array(ApiTokenPermissionSchema),
  tokensPerDay: z.number().int().positive(),
  currentDayTokens: z.number().int().nonnegative(),
  lastTokenReset: z.coerce.date().nullable(),
  isActive: z.boolean(),
  expiresAt: z.coerce.date().nullable(),
  createdBy: z.string().uuid().nullable(),
});

export type WorkspaceAgentType = z.infer<typeof WorkspaceAgentSchema>;

// Create workspace agent input
export const CreateWorkspaceAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  permissions: z.array(ApiTokenPermissionSchema).min(1),
  restrictedProjectIds: z.array(z.string().uuid()).optional(), // null/empty = all projects
  tokensPerDay: z.number().int().positive().optional(),
  expiresAt: z.coerce.date().optional(),
});

export type CreateWorkspaceAgent = z.infer<typeof CreateWorkspaceAgentSchema>;

// Update workspace agent input
export const UpdateWorkspaceAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
  permissions: z.array(ApiTokenPermissionSchema).min(1).optional(),
  restrictedProjectIds: z.array(z.string().uuid()).nullable().optional(),
  tokensPerDay: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

export type UpdateWorkspaceAgent = z.infer<typeof UpdateWorkspaceAgentSchema>;

// Agent with the actual secret (only returned on creation)
export const WorkspaceAgentWithSecretSchema = WorkspaceAgentSchema.extend({
  token: z.string().regex(TOKEN_REGEX),
});

export type WorkspaceAgentWithSecret = z.infer<typeof WorkspaceAgentWithSecretSchema>;

// Verified agent context (returned after token verification)
export interface VerifiedAgent {
  id: string;
  workspaceId: string;
  restrictedProjectIds: string[] | null; // null = all projects allowed
  name: string;
  permissions: ApiTokenPermission[];
  tokensPerDay: number;
  currentDayTokens: number;
}

// Token verification result
export const TokenVerificationResultSchema = z.discriminatedUnion('valid', [
  z.object({
    valid: z.literal(true),
    agent: WorkspaceAgentSchema,
  }),
  z.object({
    valid: z.literal(false),
    error: z.enum([
      'INVALID_FORMAT',
      'TOKEN_NOT_FOUND',
      'TOKEN_EXPIRED',
      'TOKEN_INACTIVE',
      'RATE_LIMITED',
      'LOCKED_OUT',
    ]),
    message: z.string(),
  }),
]);

export type TokenVerificationResult = z.infer<typeof TokenVerificationResultSchema>;

// Legacy type aliases for backwards compatibility during transition
/** @deprecated Use WorkspaceAgentSchema instead */
export const ApiTokenSchema = WorkspaceAgentSchema;
/** @deprecated Use WorkspaceAgentType instead */
export type ApiToken = WorkspaceAgentType;
/** @deprecated Use CreateWorkspaceAgentSchema instead */
export const CreateApiTokenSchema = CreateWorkspaceAgentSchema;
/** @deprecated Use CreateWorkspaceAgent instead */
export type CreateApiToken = CreateWorkspaceAgent;
/** @deprecated Use UpdateWorkspaceAgentSchema instead */
export const UpdateApiTokenSchema = UpdateWorkspaceAgentSchema;
/** @deprecated Use UpdateWorkspaceAgent instead */
export type UpdateApiToken = UpdateWorkspaceAgent;
/** @deprecated Use WorkspaceAgentWithSecretSchema instead */
export const ApiTokenWithSecretSchema = WorkspaceAgentWithSecretSchema;
/** @deprecated Use WorkspaceAgentWithSecret instead */
export type ApiTokenWithSecret = WorkspaceAgentWithSecret;
