/** GitHub and Slack project integrations, and workspace outgoing webhooks. */
import { http, qs } from './http';
import type {
  CreateOutgoingWebhookInput,
  OutgoingWebhookDeliveryDto,
  OutgoingWebhookDto,
  OutgoingWebhookWithSecretDto,
  SlackChannelDto,
  SlackIntegrationDto,
  UpdateOutgoingWebhookInput,
  UpdateSlackInput,
} from './types';

// ============ GitHub ============

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

export const githubApi = {
  /** The current user's GitHub App installations. */
  getMyInstallations: async (): Promise<UserInstallation[]> =>
    (await http.get<{ installations: UserInstallation[] }>('/api/github/my-installations')).installations,
  getIntegration: (projectId: string): Promise<GitHubIntegration> => http.get(`/api/projects/${projectId}/github`),
  listInstallationRepos: async (installationId: number): Promise<GitHubRepository[]> =>
    (await http.get<{ repositories: GitHubRepository[] }>(`/api/github/installations/${installationId}/repos`))
      .repositories,
  /** Starts the install flow: a single-use state nonce bound to this session. */
  startInstall: (projectId: string): Promise<{ state: string; installUrl: string | null }> =>
    http.post(`/api/projects/${projectId}/github/install/start`),
  linkRepository: (projectId: string, input: LinkRepositoryInput): Promise<GitHubIntegration> =>
    http.post(`/api/projects/${projectId}/github/link`, input),
  unlinkRepository: (projectId: string, owner: string, repo: string): Promise<null> =>
    http.delete(`/api/projects/${projectId}/github/link${qs({ owner, repo })}`),
  triggerSync: (
    projectId: string,
    owner: string,
    repo: string
  ): Promise<{ created: number; updated: number; errors: string[] }> =>
    http.post(`/api/projects/${projectId}/github/sync`, { owner, repo }),
};

// ============ Slack ============

export const slackApi = {
  get: (projectId: string): Promise<SlackIntegrationDto> => http.get(`/api/projects/${projectId}/slack`),
  channels: async (projectId: string): Promise<SlackChannelDto[]> =>
    (await http.get<{ channels: SlackChannelDto[] }>(`/api/projects/${projectId}/slack/channels`)).channels,
  /** Returns the Slack OAuth URL to redirect to. */
  startInstall: (projectId: string): Promise<{ url: string }> =>
    http.post(`/api/projects/${projectId}/slack/install/start`),
  update: (projectId: string, patch: UpdateSlackInput): Promise<SlackIntegrationDto> =>
    http.patch(`/api/projects/${projectId}/slack`, patch),
  disconnect: (projectId: string): Promise<null> => http.delete(`/api/projects/${projectId}/slack`),
};

// ============ Outgoing webhooks ============

export const webhooksApi = {
  list: (workspaceId: string): Promise<OutgoingWebhookDto[]> => http.get(`/api/outgoing-webhooks${qs({ workspaceId })}`),
  get: (id: string): Promise<OutgoingWebhookDto> => http.get(`/api/outgoing-webhooks/${id}`),
  /** The response carries the full `secret`, shown once. */
  create: (input: CreateOutgoingWebhookInput): Promise<OutgoingWebhookWithSecretDto> =>
    http.post('/api/outgoing-webhooks', input),
  /** With `rotateSecret: true` the response carries the new `secret`. */
  update: (id: string, input: UpdateOutgoingWebhookInput): Promise<OutgoingWebhookDto | OutgoingWebhookWithSecretDto> =>
    http.patch(`/api/outgoing-webhooks/${id}`, input),
  delete: (id: string): Promise<null> => http.delete(`/api/outgoing-webhooks/${id}`),
  /** Queues a 'ping' delivery. */
  test: (id: string): Promise<{ deliveryId: string }> => http.post(`/api/outgoing-webhooks/${id}/test`),
  deliveries: (id: string, params: { limit?: number; cursor?: string | null } = {}): Promise<OutgoingWebhookDeliveryDto[]> =>
    http.get(`/api/outgoing-webhooks/${id}/deliveries${qs(params)}`),
};

export function hasWebhookSecret(
  webhook: OutgoingWebhookDto | OutgoingWebhookWithSecretDto
): webhook is OutgoingWebhookWithSecretDto {
  return 'secret' in webhook && typeof webhook.secret === 'string';
}
