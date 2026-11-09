/** A GitHub repository coordinate. */
export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

/**
 * Realtime publisher injected by the API (apps/api/src/sse/manager.ts `publishEvent`),
 * so integration-driven task writes update boards live.
 */
export type PublishRealtimeEvent = (workspaceId: string, event: string, data: object) => void;

/**
 * Interface that integration providers implement for config validation.
 * Webhook handling and notifications live in dedicated services
 * (GitHubWebhookProcessor, notifySlackForTaskEvent).
 */
export interface IntegrationProvider<TConfig> {
  /** Unique identifier for this integration type */
  type: string;

  /** Human-readable name */
  name: string;

  /** Validate a stored configuration */
  validateConfig(config: unknown): config is TConfig;

  /** Check if the integration is usable (config valid and credentials present) */
  isConfigured(config: TConfig): boolean;
}

/**
 * Task notification data for external services.
 */
export interface TaskNotification {
  taskId: string;
  taskTitle: string;
  taskUrl: string;
  projectName: string;
  /** e.g. "FLOW-123" */
  taskKey: string;
  action: 'created' | 'state_changed' | 'assigned' | 'commented' | 'completed' | 'updated';
  actorName?: string;
  details?: string;
}
