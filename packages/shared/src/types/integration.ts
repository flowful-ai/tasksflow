import { z } from 'zod';

// Integration types
export const IntegrationTypeSchema = z.enum(['github', 'slack', 'linear', 'jira']);
export type IntegrationType = z.infer<typeof IntegrationTypeSchema>;

// Sync status
export const SyncStatusSchema = z.enum(['idle', 'syncing', 'synced', 'error']);
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

// ============ GitHub config ============

/** One repository linked to a project, with the installation that grants access to it. */
export const GitHubLinkedRepositorySchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  installationId: z.number().int().positive(),
  linkedAt: z.string().nullable().optional(),
  lastSyncAt: z.string().nullable().optional(),
  syncStatus: SyncStatusSchema.optional(),
  syncError: z.string().nullable().optional(),
});
export type GitHubLinkedRepository = z.infer<typeof GitHubLinkedRepositorySchema>;

/** Canonical shape of `project_integrations.config` for `integration_type = 'github'`. */
export const GitHubConfigSchema = z.object({
  repositories: z.array(GitHubLinkedRepositorySchema),
});
export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;

// Legacy rows may carry a top-level installationId/owner/repo and repository
// entries without their own installationId. These lenient schemas only exist so
// parseGitHubConfig can normalize such rows into the canonical shape.
const LegacyLinkedRepositorySchema = GitHubLinkedRepositorySchema.extend({
  installationId: z.coerce.number().int().positive().optional(),
});
const LegacyGitHubConfigSchema = z.object({
  installationId: z.coerce.number().int().positive().optional(),
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  repositories: z.array(z.unknown()).optional(),
});

function sameRepo(a: { owner: string; repo: string }, owner: string, repo: string): boolean {
  // GitHub owner and repository names are case-insensitive.
  return a.owner.toLowerCase() === owner.toLowerCase() && a.repo.toLowerCase() === repo.toLowerCase();
}

/**
 * Parse a stored GitHub integration config into the canonical shape.
 * Never throws: malformed entries are dropped, and a malformed config yields no repositories.
 * A legacy top-level installationId is only used for repositories that are explicitly
 * linked (per-repo entries without their own id, or the legacy top-level owner/repo).
 */
export function parseGitHubConfig(raw: unknown): GitHubConfig {
  const parsed = LegacyGitHubConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { repositories: [] };
  }
  const legacy = parsed.data;
  const repositories: GitHubLinkedRepository[] = [];

  for (const entry of legacy.repositories ?? []) {
    const repoResult = LegacyLinkedRepositorySchema.safeParse(entry);
    if (!repoResult.success) continue;
    const installationId = repoResult.data.installationId ?? legacy.installationId;
    if (!installationId) continue;
    if (repositories.some((r) => sameRepo(r, repoResult.data.owner, repoResult.data.repo))) continue;
    repositories.push({ ...repoResult.data, installationId });
  }

  if (
    legacy.owner &&
    legacy.repo &&
    legacy.installationId &&
    !repositories.some((r) => sameRepo(r, legacy.owner ?? '', legacy.repo ?? ''))
  ) {
    repositories.push({
      owner: legacy.owner,
      repo: legacy.repo,
      installationId: legacy.installationId,
      linkedAt: null,
      lastSyncAt: null,
      syncStatus: 'idle',
      syncError: null,
    });
  }

  return { repositories };
}

/** Find the linked repository entry for owner/repo. Exact (case-insensitive) match only. */
export function findLinkedRepository(
  config: GitHubConfig,
  owner: string,
  repo: string
): GitHubLinkedRepository | null {
  return config.repositories.find((r) => sameRepo(r, owner, repo)) ?? null;
}

/**
 * Resolve the GitHub App installation for owner/repo.
 * Returns null when the repository isn't linked: there is deliberately no
 * fallback to another installation.
 */
export function findInstallationForRepo(config: GitHubConfig, owner: string, repo: string): number | null {
  return findLinkedRepository(config, owner, repo)?.installationId ?? null;
}

// ============ GitHub external ids ============

export interface GitHubItemRef {
  owner: string;
  repo: string;
  number: number;
}

/**
 * External id for a GitHub issue/PR link: `owner/repo#N`, lower-cased.
 * Issue numbers are only unique per repository, so the repo is part of the id.
 */
export function formatGitHubExternalId(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`.toLowerCase();
}

const EXTERNAL_ID_PATTERN = /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/;

export function parseGitHubExternalId(externalId: string): GitHubItemRef | null {
  const match = EXTERNAL_ID_PATTERN.exec(externalId);
  if (!match || !match[1] || !match[2] || !match[3]) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pull)\/(\d+)/;

export function parseGitHubItemUrl(url: string): (GitHubItemRef & { kind: 'issue' | 'pull' }) | null {
  const match = GITHUB_URL_PATTERN.exec(url);
  if (!match || !match[1] || !match[2] || !match[3] || !match[4]) return null;
  return {
    owner: match[1],
    repo: match[2],
    kind: match[3] === 'pull' ? 'pull' : 'issue',
    number: Number(match[4]),
  };
}

/** Resolve a link's repo and number from its external id, falling back to its URL. */
export function resolveGitHubLinkRef(link: { externalId: string; externalUrl: string }): GitHubItemRef | null {
  const fromId = parseGitHubExternalId(link.externalId);
  if (fromId) return fromId;
  const fromUrl = parseGitHubItemUrl(link.externalUrl);
  return fromUrl ? { owner: fromUrl.owner, repo: fromUrl.repo, number: fromUrl.number } : null;
}

// ============ Task references (e.g. FLOW-123) ============

export interface TaskReference {
  /** Project identifier, upper-cased (e.g. "FLOW"). */
  identifier: string;
  sequenceNumber: number;
}

const TASK_REFERENCE_PATTERN = /(?<![A-Za-z0-9])([A-Za-z0-9]{1,10})-(\d{1,9})(?![A-Za-z0-9])/g;
const MAX_TASK_REFERENCES = 20;

/**
 * Extract task references such as `FLOW-123` from free text or branch names
 * (`feature/flow-123-fix`). Identifiers are matched case-insensitively and
 * returned upper-cased; duplicates are removed. Callers must resolve them
 * against real projects: a match like `UTF-8` simply won't resolve.
 */
export function parseTaskReferences(text: string): TaskReference[] {
  const refs: TaskReference[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(TASK_REFERENCE_PATTERN)) {
    const identifier = match[1]?.toUpperCase();
    const sequenceNumber = Number(match[2]);
    if (!identifier || !Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1) continue;
    const key = `${identifier}-${sequenceNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ identifier, sequenceNumber });
    if (refs.length >= MAX_TASK_REFERENCES) break;
  }
  return refs;
}

// ============ GitHub webhook payloads ============

const GitHubUserRefSchema = z.object({
  login: z.string(),
  id: z.number(),
  type: z.string().optional(),
});

const GitHubAppRefSchema = z.object({ id: z.number() }).nullable().optional();

export const GitHubWebhookRepositorySchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  owner: z.object({ login: z.string() }),
});

const GitHubLabelSchema = z.union([z.string(), z.object({ name: z.string().nullable().optional() })]);

export const GitHubIssueSchema = z.object({
  id: z.number(),
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable().optional(),
  html_url: z.string(),
  state: z.enum(['open', 'closed']),
  labels: z.array(GitHubLabelSchema).default([]),
  pull_request: z.object({}).passthrough().nullable().optional(),
  performed_via_github_app: GitHubAppRefSchema,
});
export type GitHubIssue = z.infer<typeof GitHubIssueSchema>;

const InstallationRefSchema = z.object({ id: z.number() }).optional();

export const GitHubIssuesEventSchema = z.object({
  action: z.string(),
  issue: GitHubIssueSchema,
  repository: GitHubWebhookRepositorySchema,
  installation: InstallationRefSchema,
  sender: GitHubUserRefSchema,
});
export type GitHubIssuesEvent = z.infer<typeof GitHubIssuesEventSchema>;

export const GitHubIssueCommentEventSchema = z.object({
  action: z.string(),
  comment: z.object({
    id: z.number(),
    body: z.string().nullable().optional(),
    html_url: z.string(),
    user: GitHubUserRefSchema.nullable().optional(),
    performed_via_github_app: GitHubAppRefSchema,
  }),
  issue: z.object({
    number: z.number().int().positive(),
    html_url: z.string(),
    pull_request: z.object({}).passthrough().nullable().optional(),
  }),
  repository: GitHubWebhookRepositorySchema,
  installation: InstallationRefSchema,
  sender: GitHubUserRefSchema,
});
export type GitHubIssueCommentEvent = z.infer<typeof GitHubIssueCommentEventSchema>;

export const GitHubPullRequestEventSchema = z.object({
  action: z.string(),
  pull_request: z.object({
    id: z.number(),
    number: z.number().int().positive(),
    title: z.string(),
    body: z.string().nullable().optional(),
    html_url: z.string(),
    state: z.enum(['open', 'closed']),
    merged: z.boolean().nullable().optional(),
    head: z.object({ ref: z.string() }),
  }),
  repository: GitHubWebhookRepositorySchema,
  installation: InstallationRefSchema,
  sender: GitHubUserRefSchema,
});
export type GitHubPullRequestEvent = z.infer<typeof GitHubPullRequestEventSchema>;

/** Minimal envelope used to route a delivery before parsing the event-specific shape. */
export const GitHubWebhookEnvelopeSchema = z.object({
  repository: GitHubWebhookRepositorySchema.optional(),
  installation: InstallationRefSchema,
});

// ============ GitHub OAuth (user-to-server) responses ============

export const GitHubOAuthTokenResponseSchema = z.union([
  z.object({ access_token: z.string().min(1), token_type: z.string().optional() }),
  z.object({ error: z.string(), error_description: z.string().optional() }),
]);

export const GitHubUserInstallationsResponseSchema = z.object({
  total_count: z.number(),
  installations: z.array(
    z.object({
      id: z.number(),
      account: z.object({ login: z.string(), type: z.string().optional() }).nullable().optional(),
    })
  ),
});

// ============ Slack config ============

export const SlackNotificationSettingsSchema = z.object({
  taskCreated: z.boolean().default(true),
  stateChanged: z.boolean().default(true),
  assigned: z.boolean().default(true),
  commentAdded: z.boolean().default(true),
});
export type SlackNotificationSettings = z.infer<typeof SlackNotificationSettingsSchema>;

/** Canonical shape of `project_integrations.config` for `integration_type = 'slack'`. */
export const SlackConfigSchema = z.object({
  teamId: z.string().min(1),
  teamName: z.string().nullable().optional(),
  channelId: z.string().min(1),
  channelName: z.string(),
  /** Bot token, encrypted at rest. Never returned to clients. */
  botTokenEncrypted: z.string().min(1).optional(),
  botUserId: z.string().nullable().optional(),
  notifications: SlackNotificationSettingsSchema.default({}),
});
export type SlackConfig = z.infer<typeof SlackConfigSchema>;

export function parseSlackConfig(raw: unknown): SlackConfig | null {
  const result = SlackConfigSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export const UpdateSlackIntegrationSchema = z.object({
  channelId: z.string().min(1).optional(),
  isEnabled: z.boolean().optional(),
  notifications: SlackNotificationSettingsSchema.partial().optional(),
});
export type UpdateSlackIntegration = z.infer<typeof UpdateSlackIntegrationSchema>;

// ============ GitHub API inputs ============

export const LinkGitHubRepositorySchema = z.object({
  installationId: z.coerce.number().int().positive(),
  owner: z.string().min(1),
  repo: z.string().min(1),
});
export type LinkGitHubRepository = z.infer<typeof LinkGitHubRepositorySchema>;

export const GitHubRepoRefSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});
export type GitHubRepoRefInput = z.infer<typeof GitHubRepoRefSchema>;

export const LinkTaskGitHubIssueSchema = GitHubRepoRefSchema.extend({
  issueNumber: z.coerce.number().int().positive(),
});
export type LinkTaskGitHubIssue = z.infer<typeof LinkTaskGitHubIssueSchema>;

// ============ Project integration rows ============

export const ProjectIntegrationSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  integrationType: IntegrationTypeSchema,
  config: z.record(z.unknown()),
  isEnabled: z.boolean().default(true),
  lastSyncAt: z.coerce.date().nullable(),
  syncStatus: SyncStatusSchema.default('idle'),
  syncError: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date().nullable(),
});

export type ProjectIntegration = z.infer<typeof ProjectIntegrationSchema>;

// External link types
export const ExternalLinkTypeSchema = z.enum(['github_issue', 'github_pr', 'slack_message']);
export type ExternalLinkType = z.infer<typeof ExternalLinkTypeSchema>;

// External link
export const ExternalLinkSchema = z.object({
  id: z.string().uuid(),
  integrationId: z.string().uuid(),
  taskId: z.string().uuid(),
  externalType: ExternalLinkTypeSchema,
  externalId: z.string(),
  externalUrl: z.string().url(),
  lastSyncedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export type ExternalLink = z.infer<typeof ExternalLinkSchema>;
