const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;

  const config: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    credentials: 'include',
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
  const data = await response.json();

  if (!response.ok) {
    // Handle different error formats from API and Better Auth
    let message = 'An error occurred';
    let code = 'UNKNOWN';

    if (data.message) {
      // Better Auth format: { code: "...", message: "..." }
      message = data.message;
      code = data.code || code;
    } else if (data.error?.message) {
      // Nested error format: { error: { message: "...", status: ... } }
      message = data.error.message;
      code = data.error.code || code;
    } else if (data.error && typeof data.error === 'string') {
      // Simple error format: { error: "..." }
      message = data.error;
    }

    throw new ApiError(message, code, response.status);
  }

  return data;
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint),
  post: <T>(endpoint: string, body?: unknown) => request<T>(endpoint, { method: 'POST', body }),
  patch: <T>(endpoint: string, body?: unknown) => request<T>(endpoint, { method: 'PATCH', body }),
  delete: <T>(endpoint: string) => request<T>(endpoint, { method: 'DELETE' }),
};

// Workspace Agent types for API responses
export interface WorkspaceAgent {
  id: string;
  workspaceId: string;
  restrictedProjectIds: string[] | null;
  name: string;
  description: string | null;
  tokenPrefix: string;
  lastUsedAt: string | null;
  permissions: string[];
  tokensPerDay: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface WorkspaceAgentWithToken extends WorkspaceAgent {
  token: string;
}

export interface CreateWorkspaceAgentInput {
  name: string;
  description?: string;
  permissions: string[];
  restrictedProjectIds?: string[];
  tokensPerDay?: number;
  expiresAt?: string;
}

export interface UpdateWorkspaceAgentInput {
  name?: string;
  description?: string | null;
  permissions?: string[];
  restrictedProjectIds?: string[] | null;
  tokensPerDay?: number;
  isActive?: boolean;
  expiresAt?: string | null;
}

// Workspace Agent API methods
export const workspaceAgentApi = {
  list: (workspaceId: string) =>
    api.get<{ success: boolean; data: { agents: WorkspaceAgent[]; total: number } }>(
      `/api/workspaces/${workspaceId}/agents`
    ),

  create: (workspaceId: string, data: CreateWorkspaceAgentInput) =>
    api.post<{ success: boolean; data: WorkspaceAgentWithToken; message: string }>(
      `/api/workspaces/${workspaceId}/agents`,
      data
    ),

  get: (workspaceId: string, agentId: string) =>
    api.get<{ success: boolean; data: WorkspaceAgent }>(
      `/api/workspaces/${workspaceId}/agents/${agentId}`
    ),

  update: (workspaceId: string, agentId: string, data: UpdateWorkspaceAgentInput) =>
    api.patch<{ success: boolean; data: WorkspaceAgent }>(
      `/api/workspaces/${workspaceId}/agents/${agentId}`,
      data
    ),

  delete: (workspaceId: string, agentId: string) =>
    api.delete<{ success: boolean; data: null }>(
      `/api/workspaces/${workspaceId}/agents/${agentId}`
    ),

  regenerate: (workspaceId: string, agentId: string) =>
    api.post<{ success: boolean; data: WorkspaceAgentWithToken; message: string }>(
      `/api/workspaces/${workspaceId}/agents/${agentId}/regenerate`
    ),
};

export interface McpOAuthConnection {
  consentId: string;
  workspaceId: string;
  clientId: string;
  clientName: string;
  grantedBy: {
    id: string;
    email: string;
    name: string | null;
  };
  grantedByRole: string;
  toolScopes: string[];
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  lastActivityAt: string | null;
}

export const mcpConnectionApi = {
  list: (workspaceId: string) =>
    api.get<{ success: boolean; data: { connections: McpOAuthConnection[] } }>(
      `/api/workspaces/${workspaceId}/mcp-connections`
    ),

  updateScopes: (workspaceId: string, consentId: string, toolScopes: string[]) =>
    api.patch<{ success: boolean; data: McpOAuthConnection }>(
      `/api/workspaces/${workspaceId}/mcp-connections/${consentId}/scopes`,
      { toolScopes }
    ),

  delete: (workspaceId: string, consentId: string) =>
    api.delete<{ success: boolean; data: null }>(
      `/api/workspaces/${workspaceId}/mcp-connections/${consentId}`
    ),
};

export { ApiError };

// Workspace member types
export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  };
}

// Workspace invitation types
export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string | null; // null for generic invite links
  role: 'admin' | 'member';
  token: string;
  status: 'pending' | 'accepted' | 'revoked' | 'exhausted';
  maxUses: number | null; // null = unlimited
  usesCount: number;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  inviteUrl: string;
  isGeneric: boolean;
  inviter: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  workspaceName: string;
}

export interface PublicInvitation {
  id: string;
  workspaceName: string;
  email: string | null; // null for generic invite links
  role: 'admin' | 'member';
  isGeneric: boolean;
  maxUses: number | null;
  usesCount: number;
  expiresAt: string;
  invitedBy: {
    name: string | null;
    email: string;
  } | null;
}

export interface CreateInvitationInput {
  email?: string | null;
  role: 'admin' | 'member';
  maxUses?: number | null;
}

// Workspace member API methods
export const memberApi = {
  list: (workspaceId: string) =>
    api.get<{ success: boolean; data: WorkspaceMember[] }>(
      `/api/workspaces/${workspaceId}/members`
    ),

  updateRole: (workspaceId: string, memberId: string, role: 'admin' | 'member') =>
    api.patch<{ success: boolean; data: WorkspaceMember }>(
      `/api/workspaces/${workspaceId}/members/${memberId}`,
      { role }
    ),

  remove: (workspaceId: string, memberId: string) =>
    api.delete<{ success: boolean; data: null }>(
      `/api/workspaces/${workspaceId}/members/${memberId}`
    ),
};

// Invitation API methods
export const invitationApi = {
  list: (workspaceId: string, status?: 'pending' | 'accepted' | 'revoked') => {
    const params = status ? `?status=${status}` : '';
    return api.get<{ success: boolean; data: WorkspaceInvitation[] }>(
      `/api/workspaces/${workspaceId}/invitations${params}`
    );
  },

  create: (workspaceId: string, data: CreateInvitationInput) =>
    api.post<{ success: boolean; data: WorkspaceInvitation }>(
      `/api/workspaces/${workspaceId}/invitations`,
      data
    ),

  revoke: (workspaceId: string, invitationId: string) =>
    api.delete<{ success: boolean; data: null }>(
      `/api/workspaces/${workspaceId}/invitations/${invitationId}`
    ),

  // Public endpoints (no auth required for get)
  getByToken: (token: string) =>
    api.get<{ success: boolean; data: PublicInvitation }>(`/api/invitations/${token}`),

  accept: (token: string) =>
    api.post<{ success: boolean; data: { workspaceId: string; workspaceName: string } }>(
      `/api/invitations/${token}/accept`
    ),
};

// GitHub Integration types
export interface GitHubRepository {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
}

export interface LinkedRepository {
  owner: string;
  repo: string;
  linkedAt: string;
  lastSyncAt: string | null;
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  syncError: string | null;
}

export interface GitHubIntegration {
  id: string | null;
  installationId: number | null;
  repositories: LinkedRepository[];
  isEnabled: boolean;
  canLinkRepos: boolean;
}

export interface UserInstallation {
  installationId: number;
  accountLogin: string | null;
  accountType: string | null;
}

export interface LinkRepositoryInput {
  installationId: number;
  owner: string;
  repo: string;
}

// GitHub Integration API methods
export const githubApi = {
  // Get the current user's GitHub App installations
  getMyInstallations: async (): Promise<UserInstallation[]> => {
    const response = await api.get<{ success: boolean; data: { installations: UserInstallation[] } }>(
      '/api/github/my-installations'
    );
    return response.data.installations;
  },

  // Get the GitHub integration status for a project
  getIntegration: async (projectId: string): Promise<GitHubIntegration> => {
    const response = await api.get<{ success: boolean; data: GitHubIntegration }>(
      `/api/projects/${projectId}/github`
    );
    return response.data;
  },

  // List repositories from a GitHub App installation
  listInstallationRepos: async (installationId: number): Promise<GitHubRepository[]> => {
    const response = await api.get<{ success: boolean; data: { repositories: GitHubRepository[] } }>(
      `/api/github/installations/${installationId}/repos`
    );
    return response.data.repositories;
  },

  // Link a repository to a project
  linkRepository: async (projectId: string, input: LinkRepositoryInput) => {
    return api.post<{ success: boolean; data: GitHubIntegration }>(
      `/api/projects/${projectId}/github/link`,
      input
    );
  },

  // Unlink a repository from a project
  unlinkRepository: async (projectId: string, owner: string, repo: string) => {
    return api.delete<{ success: boolean }>(
      `/api/projects/${projectId}/github/link?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`
    );
  },

  // Trigger a sync for a linked repository
  triggerSync: async (projectId: string, owner: string, repo: string) => {
    return api.post<{ success: boolean; data: { created: number; updated: number; errors: string[] } }>(
      `/api/projects/${projectId}/github/sync`,
      { owner, repo }
    );
  },

  // Save installation ID after GitHub App installation
  saveInstallation: async (projectId: string, installationId: number): Promise<GitHubIntegration> => {
    const response = await api.post<{ success: boolean; data: GitHubIntegration }>(
      `/api/projects/${projectId}/github/install`,
      { installationId }
    );
    return response.data;
  },
};
