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

export { ApiError };
