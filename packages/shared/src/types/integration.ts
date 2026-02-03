import { z } from 'zod';

// Integration types
export const IntegrationTypeSchema = z.enum(['github', 'slack', 'linear', 'jira']);
export type IntegrationType = z.infer<typeof IntegrationTypeSchema>;

// GitHub config
export const GitHubConfigSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  installationId: z.number(),
});
export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;

// Slack config
export const SlackConfigSchema = z.object({
  teamId: z.string(),
  channelId: z.string(),
  channelName: z.string(),
});
export type SlackConfig = z.infer<typeof SlackConfigSchema>;

// Combined integration config
export const IntegrationConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('github'), config: GitHubConfigSchema }),
  z.object({ type: z.literal('slack'), config: SlackConfigSchema }),
]);
export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;

// Sync status
export const SyncStatusSchema = z.enum(['idle', 'syncing', 'synced', 'error']);
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

// Project integration
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

// Webhook result
export const WebhookActionSchema = z.enum(['create_task', 'update_task', 'link_task', 'ignore']);
export type WebhookAction = z.infer<typeof WebhookActionSchema>;

export const WebhookResultSchema = z.object({
  action: WebhookActionSchema,
  taskId: z.string().uuid().optional(),
  externalLink: z
    .object({
      type: ExternalLinkTypeSchema,
      id: z.string(),
      url: z.string().url(),
    })
    .optional(),
});

export type WebhookResult = z.infer<typeof WebhookResultSchema>;
