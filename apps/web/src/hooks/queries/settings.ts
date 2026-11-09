/** Settings data: app admin, AI keys/settings, agents, MCP connections, invitations, linked accounts. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppRole } from '@flowtask/shared';
import { queryKeys } from '../../api/queryKeys';
import {
  agentApi,
  appAdminApi,
  type CreateAgentInput,
  type UpdateAgentInput,
} from '../../api/agents';
import {
  invitationApi,
  mcpConnectionApi,
  workspaceAiSettingsApi,
  workspaceApiKeyApi,
  type ApiKeyProvider,
  type CreateInvitationInput,
  type WorkspaceAiSettings,
} from '../../api/workspaces';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../stores/auth';

// ============ App admin ============

/** The caller's app-level role (app_manager or user). */
export function useAppContext() {
  return useQuery({
    queryKey: queryKeys.app.me(),
    queryFn: appAdminApi.me,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useAppUsers(
  params: { search?: string; limit?: number; offset?: number },
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.app.users(params),
    queryFn: () => appAdminApi.listUsers(params),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useUpdateAppUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, appRole }: { userId: string; appRole: AppRole }) =>
      appAdminApi.updateRole(userId, appRole),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.app.all }),
    meta: { errorMessage: 'Could not update the role' },
  });
}

// ============ AI provider keys and settings ============

/** Which providers have a key. Fails with 403 for non-admins. */
export function useApiKeyStatuses(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.workspaces.apiKeys(workspaceId ?? ''),
    queryFn: () => workspaceApiKeyApi.listStatuses(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
    select: (data): Record<ApiKeyProvider, boolean> => {
      const status: Record<ApiKeyProvider, boolean> = {
        openai: false,
        anthropic: false,
        google: false,
        openrouter: false,
      };
      for (const entry of data.providers) status[entry.provider] = entry.hasKey;
      return status;
    },
  });
}

export function useApiKeyMutations(workspaceId: string) {
  const queryClient = useQueryClient();
  const onSettled = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.apiKeys(workspaceId) }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.workspaces.agentAvailability(workspaceId),
      }),
    ]);
  return {
    save: useMutation({
      mutationFn: (input: { provider: ApiKeyProvider; apiKey: string }) =>
        workspaceApiKeyApi.upsert(workspaceId, input),
      onSettled,
      meta: { errorMessage: 'Could not save the API key' },
    }),
    remove: useMutation({
      mutationFn: (provider: ApiKeyProvider) => workspaceApiKeyApi.delete(workspaceId, provider),
      onSettled,
      meta: { errorMessage: 'Could not delete the API key' },
    }),
  };
}

export function useAiSettings(workspaceId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.workspaces.aiSettings(workspaceId ?? ''),
    queryFn: () => workspaceAiSettingsApi.get(workspaceId ?? ''),
    enabled: Boolean(workspaceId) && enabled,
  });
}

export function useUpdateAiSettings(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: WorkspaceAiSettings) =>
      workspaceAiSettingsApi.update(workspaceId, settings),
    onSuccess: (data) =>
      queryClient.setQueryData(queryKeys.workspaces.aiSettings(workspaceId), data),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.aiSettings(workspaceId) }),
    meta: { errorMessage: 'Could not save chat defaults' },
  });
}

// ============ Agents ============

export function useAgents(
  workspaceId: string | null | undefined,
  active: boolean | 'all' = 'all',
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.workspaces.agents(workspaceId ?? '', active),
    queryFn: () => agentApi.list(workspaceId ?? '', active),
    enabled: Boolean(workspaceId) && enabled,
  });
}

export function useAgentMutations(workspaceId: string) {
  const queryClient = useQueryClient();
  const onSettled = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.agentLists(workspaceId) }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.workspaces.agentAvailability(workspaceId),
      }),
    ]);
  return {
    create: useMutation({
      mutationFn: (input: Omit<CreateAgentInput, 'workspaceId'>) =>
        agentApi.create({ ...input, workspaceId }),
      onSettled,
      meta: { errorMessage: 'Could not create the agent' },
    }),
    update: useMutation({
      mutationFn: ({ agentId, ...input }: UpdateAgentInput & { agentId: string }) =>
        agentApi.update(agentId, input),
      onSettled,
      meta: { errorMessage: 'Could not update the agent' },
    }),
    remove: useMutation({
      mutationFn: (agentId: string) => agentApi.delete(agentId),
      onSettled,
      meta: { errorMessage: 'Could not delete the agent' },
    }),
  };
}

// ============ MCP connections ============

export function useMcpConnections(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.workspaces.mcpConnections(workspaceId ?? ''),
    queryFn: () => mcpConnectionApi.list(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
}

export function useMcpConnectionMutations(workspaceId: string) {
  const queryClient = useQueryClient();
  const onSettled = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.mcpConnections(workspaceId) });
  return {
    updateScopes: useMutation({
      mutationFn: ({ consentId, toolScopes }: { consentId: string; toolScopes: string[] }) =>
        mcpConnectionApi.updateScopes(workspaceId, consentId, toolScopes),
      onSettled,
      meta: { errorMessage: 'Could not update the scopes' },
    }),
    remove: useMutation({
      mutationFn: (consentId: string) => mcpConnectionApi.delete(workspaceId, consentId),
      onSettled,
      meta: { errorMessage: 'Could not delete the connection' },
    }),
  };
}

// ============ Invitations ============

/** Pending invitations (admins only: pass enabled=false for members). */
export function useInvitations(workspaceId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.workspaces.invitations(workspaceId ?? ''),
    queryFn: () => invitationApi.list(workspaceId ?? '', 'pending'),
    enabled: Boolean(workspaceId) && enabled,
  });
}

export function useInvitationMutations(workspaceId: string) {
  const queryClient = useQueryClient();
  const onSettled = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.invitations(workspaceId) });
  return {
    create: useMutation({
      mutationFn: (input: CreateInvitationInput) => invitationApi.create(workspaceId, input),
      onSettled,
      meta: { silentError: true },
    }),
    revoke: useMutation({
      mutationFn: (invitationId: string) => invitationApi.revoke(workspaceId, invitationId),
      onSettled,
      meta: { errorMessage: 'Could not revoke the invitation' },
    }),
  };
}

/** Public invitation details (no auth). */
export function usePublicInvitation(token: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.invitations.byToken(token ?? ''),
    queryFn: () => invitationApi.getByToken(token ?? ''),
    enabled: Boolean(token),
    retry: false,
  });
}

// ============ Linked accounts ============

export function useLinkedAccounts() {
  return useQuery({ queryKey: queryKeys.auth.linkedAccounts(), queryFn: authApi.listAccounts });
}

export function useUnlinkAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { providerId: string; accountId?: string }) => authApi.unlinkAccount(input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.auth.linkedAccounts() }),
    meta: { errorMessage: 'Could not disconnect the account' },
  });
}

// ============ Profile and sessions ============

/** Rename yourself. Names appear everywhere (sidebar, members, assignees), so refetch it all. */
export function useUpdateProfileName() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      await authApi.updateName(name);
      return name;
    },
    onSuccess: async (name) => {
      useAuthStore.setState((state) => (state.user ? { user: { ...state.user, name } } : state));
      await Promise.all([useAuthStore.getState().checkAuth(), queryClient.invalidateQueries()]);
    },
    meta: { errorMessage: 'Could not save your name' },
  });
}

/** The caller's active sessions, plus which one is this browser. */
export function useSessions() {
  return useQuery({
    queryKey: queryKeys.auth.sessions(),
    queryFn: async () => {
      const [sessions, currentId] = await Promise.all([
        authApi.listSessions(),
        authApi.currentSessionId(),
      ]);
      return { sessions, currentId };
    },
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => authApi.revokeSession(token),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions() }),
    meta: { errorMessage: 'Could not sign out that session' },
  });
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => authApi.revokeOtherSessions(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions() }),
    meta: { silentError: true },
  });
}
