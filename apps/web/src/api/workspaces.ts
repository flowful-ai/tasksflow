/** Workspaces, members, invitations, workspace AI settings and MCP connections. */
import type { ApiKeyProvider, WorkspaceAiSettings } from '@flowtask/shared';
import { api, http, qs, type ApiEnvelope, type CursorMeta } from './http';
import type {
  PublicInvitationDto,
  WorkspaceActivityItemDto,
  WorkspaceDetailDto,
  WorkspaceDto,
  WorkspaceMemberDto,
  WorkspaceRole,
} from './types';

export const workspacesApi = {
  list: (): Promise<WorkspaceDetailDto[]> => http.get('/api/workspaces'),
  get: (workspaceId: string): Promise<WorkspaceDetailDto> =>
    http.get(`/api/workspaces/${workspaceId}`),
  create: (input: { name: string; slug: string }): Promise<WorkspaceDto> =>
    http.post('/api/workspaces', input),
  /** The caller's role in the workspace. */
  me: (workspaceId: string): Promise<{ role: WorkspaceRole }> =>
    http.get(`/api/workspaces/${workspaceId}/me`),
  activity: (
    workspaceId: string,
    params: { limit?: number; cursor?: string | null } = {}
  ): Promise<ApiEnvelope<WorkspaceActivityItemDto[], CursorMeta>> =>
    api.get(`/api/workspaces/${workspaceId}/activity${qs(params)}`),
  /** Owner only. The previous owner becomes an admin. */
  transferOwnership: (workspaceId: string, userId: string): Promise<WorkspaceMemberDto> =>
    http.post(`/api/workspaces/${workspaceId}/transfer-ownership`, { userId }),
};

export const memberApi = {
  list: (workspaceId: string): Promise<WorkspaceMemberDto[]> =>
    http.get(`/api/workspaces/${workspaceId}/members`),
  /** `userId` is the member's user id. */
  updateRole: (
    workspaceId: string,
    userId: string,
    role: 'admin' | 'member'
  ): Promise<WorkspaceMemberDto> =>
    http.patch(`/api/workspaces/${workspaceId}/members/${userId}`, { role }),
  remove: (workspaceId: string, userId: string): Promise<null> =>
    http.delete(`/api/workspaces/${workspaceId}/members/${userId}`),
};

/** Invitation as returned by the invitations routes (adds inviteUrl/inviter to the stored row). */
export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  /** null for generic invite links */
  email: string | null;
  role: 'admin' | 'member';
  token: string;
  status: 'pending' | 'accepted' | 'revoked' | 'exhausted';
  /** null = unlimited */
  maxUses: number | null;
  usesCount: number;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  inviteUrl: string;
  isGeneric: boolean;
  inviter: { id: string; name: string | null; email: string } | null;
  workspaceName: string;
}

export type PublicInvitation = PublicInvitationDto;

export interface CreateInvitationInput {
  email?: string | null;
  role: 'admin' | 'member';
  maxUses?: number | null;
}

export const invitationApi = {
  list: (
    workspaceId: string,
    status?: 'pending' | 'accepted' | 'revoked'
  ): Promise<WorkspaceInvitation[]> =>
    http.get(`/api/workspaces/${workspaceId}/invitations${qs({ status })}`),
  create: (workspaceId: string, data: CreateInvitationInput): Promise<WorkspaceInvitation> =>
    http.post(`/api/workspaces/${workspaceId}/invitations`, data),
  revoke: (workspaceId: string, invitationId: string): Promise<null> =>
    http.delete(`/api/workspaces/${workspaceId}/invitations/${invitationId}`),
  /** Public (no auth). */
  getByToken: (token: string): Promise<PublicInvitation> => http.get(`/api/invitations/${token}`),
  accept: (token: string): Promise<{ workspaceId: string; workspaceName: string }> =>
    http.post(`/api/invitations/${token}/accept`),
};

export type { ApiKeyProvider, WorkspaceAiSettings };

export interface WorkspaceApiKeyStatus {
  hasKey: boolean;
  provider: ApiKeyProvider;
}

export const workspaceApiKeyApi = {
  listStatuses: (workspaceId: string): Promise<{ providers: WorkspaceApiKeyStatus[] }> =>
    http.get(`/api/workspaces/${workspaceId}/api-keys`),
  upsert: (
    workspaceId: string,
    data: { provider: ApiKeyProvider; apiKey: string }
  ): Promise<{ id: string; workspaceId: string; provider: ApiKeyProvider; createdAt: string }> =>
    http.post(`/api/workspaces/${workspaceId}/api-keys`, data),
  status: (workspaceId: string, provider: ApiKeyProvider): Promise<WorkspaceApiKeyStatus> =>
    http.get(`/api/workspaces/${workspaceId}/api-keys/${provider}`),
  delete: (workspaceId: string, provider: ApiKeyProvider): Promise<null> =>
    http.delete(`/api/workspaces/${workspaceId}/api-keys/${provider}`),
};

export const workspaceAiSettingsApi = {
  get: (workspaceId: string): Promise<WorkspaceAiSettings> =>
    http.get(`/api/workspaces/${workspaceId}/ai-settings`),
  update: (workspaceId: string, data: WorkspaceAiSettings): Promise<WorkspaceAiSettings> =>
    http.patch(`/api/workspaces/${workspaceId}/ai-settings`, data),
};

export interface McpOAuthConnection {
  consentId: string;
  workspaceId: string;
  clientId: string;
  clientName: string;
  grantedBy: { id: string; email: string; name: string | null };
  grantedByRole: string;
  toolScopes: string[];
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  lastActivityAt: string | null;
}

export const mcpConnectionApi = {
  list: async (workspaceId: string): Promise<McpOAuthConnection[]> =>
    (
      await http.get<{ connections: McpOAuthConnection[] }>(
        `/api/workspaces/${workspaceId}/mcp-connections`
      )
    ).connections,
  updateScopes: (
    workspaceId: string,
    consentId: string,
    toolScopes: string[]
  ): Promise<McpOAuthConnection> =>
    http.patch(`/api/workspaces/${workspaceId}/mcp-connections/${consentId}/scopes`, {
      toolScopes,
    }),
  delete: (workspaceId: string, consentId: string): Promise<null> =>
    http.delete(`/api/workspaces/${workspaceId}/mcp-connections/${consentId}`),
};
