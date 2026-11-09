import type { Agent } from '../../db/index.js';
import type { CreateAgent, UpdateAgent, AIModel, AgentExecution, RunAgent, ApiKeyProvider } from '@flowtask/shared';

export interface AgentWithRelations extends Agent {
  // Additional computed fields
  isRateLimited: boolean;
  remainingTokensToday: number;
}

export interface AgentCreateInput extends CreateAgent {
  workspaceId: string;
  createdBy: string;
}

export interface AgentUpdateInput extends UpdateAgent {
  updatedBy: string;
}

export interface ApiKeyCreateInput {
  workspaceId: string;
  provider: ApiKeyProvider;
  apiKey: string;
}

export interface AgentFilters {
  workspaceId?: string;
  isActive?: boolean;
  model?: AIModel;
}

export interface AgentListOptions {
  filters?: AgentFilters;
  sortBy?: 'name' | 'created_at';
  sortOrder?: 'asc' | 'desc';
}

export interface AgentRunInput extends RunAgent {
  agentId: string;
  userId: string;
}

export interface AgentRunResult {
  execution: AgentExecution;
  response: string;
}

export * from './tools.js';
