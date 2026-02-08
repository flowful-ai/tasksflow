import type { TaskEvent } from '@flowtask/shared';

/**
 * Integration configuration types.
 */
export interface GitHubConfig {
  owner: string;
  repo: string;
  installationId: number;
}

export interface SlackConfig {
  teamId: string;
  channelId: string;
  channelName: string;
}

export type IntegrationConfig = {
  github?: GitHubConfig;
  slack?: SlackConfig;
};

/**
 * Result of processing a webhook.
 */
export interface WebhookResult {
  action: 'create_task' | 'update_task' | 'link_task' | 'sync_comment' | 'update_comment' | 'delete_comment' | 'ignore';
  taskId?: string;
  externalLink?: {
    type: 'github_issue' | 'github_pr' | 'slack_message';
    id: string;
    url: string;
  };
  commentData?: {
    externalCommentId: string;
    body: string;
    authorLogin: string;
    authorId: number;
    url: string;
    issueNumber: number;
  };
}

/**
 * Interface that all integration providers must implement.
 */
export interface IntegrationProvider<TConfig = unknown> {
  /** Unique identifier for this integration type */
  type: string;

  /** Human-readable name */
  name: string;

  /** Validate the configuration */
  validateConfig(config: unknown): config is TConfig;

  /** Handle incoming webhooks (one-way: external → FlowTask) */
  handleWebhook(payload: unknown, config: TConfig): Promise<WebhookResult>;

  /** Send notifications (one-way: FlowTask → external) */
  notify?(event: TaskEvent, config: TConfig): Promise<void>;

  /** Check if the integration is properly configured */
  isConfigured(config: TConfig): boolean;
}

/**
 * GitHub webhook event types we handle.
 */
export type GitHubWebhookEvent =
  | 'issues'
  | 'issue_comment'
  | 'pull_request'
  | 'pull_request_review'
  | 'push';

/**
 * GitHub webhook payload (simplified).
 */
export interface GitHubIssueWebhookPayload {
  action: 'opened' | 'edited' | 'closed' | 'reopened' | 'assigned' | 'unassigned' | 'labeled' | 'unlabeled';
  issue: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: 'open' | 'closed';
    labels: Array<{ name: string; color: string }>;
    assignees: Array<{ login: string; id: number }>;
    user: { login: string; id: number };
    created_at: string;
    updated_at: string;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: { login: string };
  };
  sender: { login: string; id: number };
  installation?: { id: number };
}

export interface GitHubPRWebhookPayload {
  action: 'opened' | 'edited' | 'closed' | 'reopened' | 'synchronize' | 'review_requested';
  pull_request: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: 'open' | 'closed';
    merged: boolean;
    head: { ref: string; sha: string };
    base: { ref: string };
    user: { login: string; id: number };
    created_at: string;
    updated_at: string;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: { login: string };
  };
  sender: { login: string; id: number };
  installation?: { id: number };
}

export interface GitHubIssueCommentWebhookPayload {
  action: 'created' | 'edited' | 'deleted';
  comment: {
    id: number;
    body: string;
    html_url: string;
    user: { login: string; id: number };
    created_at: string;
    updated_at: string;
  };
  issue: {
    number: number;
    html_url: string;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: { login: string };
  };
  sender: { login: string; id: number };
  installation?: { id: number };
}

/**
 * Slack event types we handle.
 */
export type SlackEventType = 'message' | 'app_mention' | 'reaction_added';

/**
 * Slack event payload (simplified).
 */
export interface SlackMessagePayload {
  type: 'message';
  channel: string;
  user: string;
  text: string;
  ts: string;
  team: string;
  event_ts: string;
}

export interface SlackAppMentionPayload {
  type: 'app_mention';
  channel: string;
  user: string;
  text: string;
  ts: string;
  team: string;
  event_ts: string;
}

/**
 * Task notification data for external services.
 */
export interface TaskNotification {
  taskId: string;
  taskTitle: string;
  taskUrl: string;
  projectName: string;
  projectIdentifier: string;
  action: 'created' | 'updated' | 'completed' | 'commented';
  actor?: {
    name: string;
    email: string;
  };
  details?: string;
}
