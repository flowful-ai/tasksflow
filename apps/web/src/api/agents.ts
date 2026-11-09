/** AI agents and app administration. */
import type { AppRole } from '@flowtask/shared';
import { http, qs } from './http';
import type { AppContextDto, AppManagedUserDto, AppUsersListResponseDto } from './types';

export type AIModel = string;

export interface AgentSummary {
  id: string;
  workspaceId: string;
  name: string;
  model: AIModel;
  tools: string[];
  isActive: boolean;
}

export interface AgentDetail extends AgentSummary {
  systemPrompt: string | null;
  requestsPerMinute: number;
  tokensPerDay: number;
  currentDayTokens: number;
  lastTokenReset: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CreateAgentInput {
  workspaceId: string;
  name: string;
  model: AIModel;
  systemPrompt?: string;
  tools?: string[];
  requestsPerMinute?: number;
  tokensPerDay?: number;
}

export interface UpdateAgentInput {
  name?: string;
  model?: AIModel;
  systemPrompt?: string;
  tools?: string[];
  requestsPerMinute?: number;
  tokensPerDay?: number;
  isActive?: boolean;
}

export interface AgentAvailability {
  enabled: boolean;
  hasProviderKey: boolean;
  modelCount: number;
  activeAgentCount: number;
}

export const agentApi = {
  list: (workspaceId: string, isActive: boolean | 'all' = true): Promise<AgentSummary[]> =>
    http.get(`/api/agents${qs({ workspaceId, isActive: String(isActive) })}`),
  get: (agentId: string): Promise<AgentDetail> => http.get(`/api/agents/${agentId}`),
  create: (data: CreateAgentInput): Promise<AgentDetail> => http.post('/api/agents', data),
  update: (agentId: string, data: UpdateAgentInput): Promise<AgentDetail> =>
    http.patch(`/api/agents/${agentId}`, data),
  delete: (agentId: string): Promise<null> => http.delete(`/api/agents/${agentId}`),
  availability: (workspaceId: string): Promise<AgentAvailability> =>
    http.get(`/api/agents/availability${qs({ workspaceId })}`),
};

export type AppContext = AppContextDto;
export type AppManagedUser = AppManagedUserDto;
export type AppUsersListResponse = AppUsersListResponseDto;

export const appAdminApi = {
  me: (): Promise<AppContext> => http.get('/api/app/me'),
  listUsers: (
    params: { search?: string; limit?: number; offset?: number } = {}
  ): Promise<AppUsersListResponse> => http.get(`/api/app/users${qs(params)}`),
  updateRole: (userId: string, appRole: AppRole): Promise<AppManagedUser> =>
    http.patch(`/api/app/users/${userId}/role`, { appRole }),
};
