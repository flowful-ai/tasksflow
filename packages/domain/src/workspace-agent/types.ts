import type { WorkspaceAgent } from '@flowtask/database';
import type { CreateWorkspaceAgent, UpdateWorkspaceAgent, ApiTokenPermission } from '@flowtask/shared';

export interface WorkspaceAgentWithWorkspace extends WorkspaceAgent {
  workspace?: {
    id: string;
    name: string;
    slug: string;
  };
}

export interface WorkspaceAgentCreateInput extends CreateWorkspaceAgent {
  workspaceId: string;
  createdBy: string;
}

export interface WorkspaceAgentUpdateInput extends UpdateWorkspaceAgent {
  updatedBy: string;
}

export interface WorkspaceAgentFilters {
  workspaceId?: string;
  isActive?: boolean;
}

export interface WorkspaceAgentListOptions {
  filters?: WorkspaceAgentFilters;
  sortBy?: 'name' | 'created_at' | 'last_used_at';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface TokenGenerationResult {
  token: string; // The raw token (only shown once)
  tokenHash: string; // bcrypt hash for storage
  tokenPrefix: string; // 12-char prefix for lookup
}

export interface VerifiedAgent {
  id: string;
  workspaceId: string;
  restrictedProjectIds: string[] | null; // null = all projects in workspace
  name: string;
  permissions: ApiTokenPermission[];
  tokensPerDay: number;
  currentDayTokens: number;
}

export interface TokenVerifyOptions {
  checkRateLimit?: boolean;
  toolName?: string; // If provided, also check if tool is permitted
}
