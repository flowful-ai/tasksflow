/** GitHub, Slack and outgoing webhooks. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { githubApi, slackApi, webhooksApi, type LinkRepositoryInput } from '../../api/integrations';
import type {
  CreateOutgoingWebhookInput,
  UpdateOutgoingWebhookInput,
  UpdateSlackInput,
} from '../../api/types';

// ============ GitHub ============

/** GitHub integration of a project (one shared query; was defined 3 times). */
export function useGitHubIntegration(projectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.github(projectId ?? ''),
    queryFn: () => githubApi.getIntegration(projectId ?? ''),
    enabled: Boolean(projectId),
  });
}

export function useGitHubInstallations(enabled = true) {
  return useQuery({
    queryKey: queryKeys.github.installations(),
    queryFn: githubApi.getMyInstallations,
    enabled,
  });
}

export function useGitHubRepos(installationId: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.github.repos(installationId ?? 0),
    queryFn: () => githubApi.listInstallationRepos(installationId ?? 0),
    enabled: typeof installationId === 'number',
  });
}

export function useGitHubMutations(projectId: string) {
  const queryClient = useQueryClient();
  const onSettled = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.github(projectId) });
  return {
    link: useMutation({
      mutationFn: (input: LinkRepositoryInput) => githubApi.linkRepository(projectId, input),
      onSettled,
      meta: { errorMessage: 'Could not link the repository' },
    }),
    unlink: useMutation({
      mutationFn: ({ owner, repo }: { owner: string; repo: string }) =>
        githubApi.unlinkRepository(projectId, owner, repo),
      onSettled,
      meta: { errorMessage: 'Could not unlink the repository' },
    }),
    sync: useMutation({
      mutationFn: ({ owner, repo }: { owner: string; repo: string }) =>
        githubApi.triggerSync(projectId, owner, repo),
      onSettled: () =>
        Promise.all([
          onSettled(),
          queryClient.invalidateQueries({ queryKey: queryKeys.tasks.project(projectId) }),
        ]),
      meta: { errorMessage: 'Sync failed' },
    }),
  };
}

// ============ Slack ============

export function useSlackIntegration(projectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.slack(projectId ?? ''),
    queryFn: () => slackApi.get(projectId ?? ''),
    enabled: Boolean(projectId),
  });
}

export function useSlackChannels(projectId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.projects.slackChannels(projectId ?? ''),
    queryFn: () => slackApi.channels(projectId ?? ''),
    enabled: Boolean(projectId) && enabled,
  });
}

export function useSlackMutations(projectId: string) {
  const queryClient = useQueryClient();
  const onSettled = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.slack(projectId) });
  return {
    update: useMutation({
      mutationFn: (patch: UpdateSlackInput) => slackApi.update(projectId, patch),
      onSuccess: (data) => queryClient.setQueryData(queryKeys.projects.slack(projectId), data),
      onSettled,
      meta: { errorMessage: 'Could not update Slack settings' },
    }),
    disconnect: useMutation({
      mutationFn: () => slackApi.disconnect(projectId),
      onSettled: () => {
        queryClient.removeQueries({ queryKey: queryKeys.projects.slackChannels(projectId) });
        return onSettled();
      },
      meta: { errorMessage: 'Could not disconnect Slack' },
    }),
  };
}

// ============ Outgoing webhooks ============

export function useWebhooks(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.workspaces.webhooks(workspaceId ?? ''),
    queryFn: () => webhooksApi.list(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
}

/** Recent deliveries of one webhook (newest first). Polls while a delivery is pending. */
export function useWebhookDeliveries(webhookId: string | null | undefined, limit = 20) {
  return useQuery({
    queryKey: queryKeys.webhooks.deliveries(webhookId ?? ''),
    queryFn: () => webhooksApi.deliveries(webhookId ?? '', { limit }),
    enabled: Boolean(webhookId),
    refetchInterval: (query) =>
      query.state.data?.some((d) => d.status === 'pending') ? 3000 : false,
  });
}

export function useWebhookMutations(workspaceId: string) {
  const queryClient = useQueryClient();
  const onSettled = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.webhooks(workspaceId) });
  return {
    create: useMutation({
      mutationFn: (input: Omit<CreateOutgoingWebhookInput, 'workspaceId'>) =>
        webhooksApi.create({ ...input, workspaceId }),
      onSettled,
      meta: { errorMessage: 'Could not create the webhook' },
    }),
    update: useMutation({
      mutationFn: ({ id, ...input }: UpdateOutgoingWebhookInput & { id: string }) =>
        webhooksApi.update(id, input),
      onSettled,
      meta: { errorMessage: 'Could not update the webhook' },
    }),
    remove: useMutation({
      mutationFn: (id: string) => webhooksApi.delete(id),
      onSettled,
      meta: { errorMessage: 'Could not delete the webhook' },
    }),
    test: useMutation({
      mutationFn: (id: string) => webhooksApi.test(id),
      onSettled: (_data, _error, id) =>
        queryClient.invalidateQueries({ queryKey: queryKeys.webhooks.deliveries(id) }),
      meta: { errorMessage: 'Could not send the test delivery' },
    }),
  };
}
