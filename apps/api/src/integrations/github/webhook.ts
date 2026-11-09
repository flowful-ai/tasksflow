import {
  GitHubIssueCommentEventSchema,
  GitHubIssuesEventSchema,
  GitHubPullRequestEventSchema,
  type TaskPriority,
} from '@flowtask/shared';
import type { GitHubRepoRef } from '../types.js';

/**
 * Classified GitHub webhook delivery. Produced from the `X-GitHub-Event`
 * header plus a Zod-validated payload; anything we don't handle is `ignore`.
 */
export type GitHubWebhookAction =
  | {
      kind: 'issue';
      action: 'opened' | 'edited' | 'closed' | 'reopened' | 'labeled' | 'unlabeled' | 'assigned' | 'unassigned';
      repo: GitHubRepoRef;
      installationId: number | null;
      issueNumber: number;
      /** Set when the issue was created by a GitHub App (e.g. FlowTask itself). */
      createdByAppId: number | null;
    }
  | {
      kind: 'issue_comment';
      action: 'created' | 'edited' | 'deleted';
      repo: GitHubRepoRef;
      installationId: number | null;
      issueNumber: number;
      comment: {
        id: string;
        body: string;
        authorLogin: string;
        authorId: number;
        viaAppId: number | null;
      };
    }
  | {
      kind: 'pull_request';
      action: 'opened' | 'edited' | 'reopened' | 'closed' | 'synchronize';
      repo: GitHubRepoRef;
      installationId: number | null;
      pr: {
        number: number;
        url: string;
        title: string;
        body: string;
        branch: string;
        merged: boolean;
      };
    }
  | { kind: 'ignore'; reason: string };

const ISSUE_ACTIONS = ['opened', 'edited', 'closed', 'reopened', 'labeled', 'unlabeled', 'assigned', 'unassigned'] as const;
const COMMENT_ACTIONS = ['created', 'edited', 'deleted'] as const;
const PR_ACTIONS = ['opened', 'edited', 'reopened', 'closed', 'synchronize'] as const;

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return values.some((v) => v === value);
}

function repoOf(repository: { name: string; owner: { login: string } }): GitHubRepoRef {
  return { owner: repository.owner.login, repo: repository.name };
}

export function parseGitHubWebhook(eventName: string, payload: unknown): GitHubWebhookAction {
  if (eventName === 'issues') {
    const parsed = GitHubIssuesEventSchema.safeParse(payload);
    if (!parsed.success) return { kind: 'ignore', reason: 'Malformed issues payload' };
    const { action, issue, repository, installation } = parsed.data;
    if (!isOneOf(ISSUE_ACTIONS, action)) return { kind: 'ignore', reason: `Unhandled issues action: ${action}` };
    // Issues API objects can describe pull requests; those are handled via pull_request events.
    if (issue.pull_request) return { kind: 'ignore', reason: 'Issue event for a pull request' };
    return {
      kind: 'issue',
      action,
      repo: repoOf(repository),
      installationId: installation?.id ?? null,
      issueNumber: issue.number,
      createdByAppId: issue.performed_via_github_app?.id ?? null,
    };
  }

  if (eventName === 'issue_comment') {
    const parsed = GitHubIssueCommentEventSchema.safeParse(payload);
    if (!parsed.success) return { kind: 'ignore', reason: 'Malformed issue_comment payload' };
    const { action, comment, issue, repository, installation, sender } = parsed.data;
    if (!isOneOf(COMMENT_ACTIONS, action)) return { kind: 'ignore', reason: `Unhandled comment action: ${action}` };
    if (issue.pull_request) return { kind: 'ignore', reason: 'Comment on a pull request' };
    return {
      kind: 'issue_comment',
      action,
      repo: repoOf(repository),
      installationId: installation?.id ?? null,
      issueNumber: issue.number,
      comment: {
        id: comment.id.toString(),
        body: comment.body ?? '',
        authorLogin: comment.user?.login ?? sender.login,
        authorId: comment.user?.id ?? sender.id,
        viaAppId: comment.performed_via_github_app?.id ?? null,
      },
    };
  }

  if (eventName === 'pull_request') {
    const parsed = GitHubPullRequestEventSchema.safeParse(payload);
    if (!parsed.success) return { kind: 'ignore', reason: 'Malformed pull_request payload' };
    const { action, pull_request: pr, repository, installation } = parsed.data;
    if (!isOneOf(PR_ACTIONS, action)) return { kind: 'ignore', reason: `Unhandled pull_request action: ${action}` };
    return {
      kind: 'pull_request',
      action,
      repo: repoOf(repository),
      installationId: installation?.id ?? null,
      pr: {
        number: pr.number,
        url: pr.html_url,
        title: pr.title,
        body: pr.body ?? '',
        branch: pr.head.ref,
        merged: pr.merged === true,
      },
    };
  }

  return { kind: 'ignore', reason: `Unhandled event: ${eventName}` };
}

type LabelLike = string | { name?: string | null };

/** Label names from either webhook payloads (objects) or REST responses (strings or objects). */
export function labelNames(labels: readonly LabelLike[]): string[] {
  const names: string[] = [];
  for (const label of labels) {
    const name = typeof label === 'string' ? label : label.name;
    if (name) names.push(name);
  }
  return names;
}

const PRIORITY_LABELS: Record<string, TaskPriority> = {
  'priority:urgent': 'urgent',
  'priority:high': 'high',
  'priority:medium': 'medium',
  'priority:low': 'low',
  urgent: 'urgent',
  high: 'high',
  medium: 'medium',
  low: 'low',
  p0: 'urgent',
  p1: 'high',
  p2: 'medium',
  p3: 'low',
};

/** Map GitHub labels to a FlowTask priority. */
export function mapLabelsToPriority(labels: readonly LabelLike[]): TaskPriority | null {
  for (const name of labelNames(labels)) {
    const priority = PRIORITY_LABELS[name.toLowerCase()];
    if (priority) return priority;
  }
  return null;
}

/** Normalized issue content used for sync hashing and task writes. */
export interface IssueContent {
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
}

/** Accepts webhook issues and REST responses (whose `state` is typed as a plain string). */
export function issueContentFrom(issue: {
  title: string;
  body?: string | null;
  state: string;
  labels: readonly LabelLike[];
}): IssueContent {
  return {
    title: issue.title,
    body: issue.body ?? '',
    state: issue.state === 'closed' ? 'closed' : 'open',
    labels: labelNames(issue.labels),
  };
}
