import type {
  GitHubConfig,
  WebhookResult,
  GitHubIssueWebhookPayload,
  GitHubPRWebhookPayload,
  GitHubIssueCommentWebhookPayload,
} from '../types.js';
import type { TaskPriority } from '@flowtask/shared';

/**
 * Handles GitHub webhook events and converts them to FlowTask actions.
 */
export class GitHubWebhookHandler {
  /**
   * Handle GitHub issue events.
   */
  async handleIssueEvent(
    payload: GitHubIssueWebhookPayload,
    config: GitHubConfig
  ): Promise<WebhookResult> {
    const { action, issue, repository } = payload;

    // Verify this is for the configured repository
    if (repository.owner.login !== config.owner || repository.name !== config.repo) {
      return { action: 'ignore' };
    }

    switch (action) {
      case 'opened':
        return {
          action: 'create_task',
          externalLink: {
            type: 'github_issue',
            id: issue.number.toString(),
            url: issue.html_url,
          },
        };

      case 'edited':
      case 'closed':
      case 'reopened':
      case 'assigned':
      case 'unassigned':
      case 'labeled':
      case 'unlabeled':
        return {
          action: 'update_task',
          externalLink: {
            type: 'github_issue',
            id: issue.number.toString(),
            url: issue.html_url,
          },
        };

      default:
        return { action: 'ignore' };
    }
  }

  /**
   * Handle GitHub issue comment events.
   */
  async handleIssueCommentEvent(
    payload: GitHubIssueCommentWebhookPayload,
    config: GitHubConfig
  ): Promise<WebhookResult> {
    const { action, comment, issue, repository, sender } = payload;

    // Verify this is for the configured repository
    if (repository.owner.login !== config.owner || repository.name !== config.repo) {
      return { action: 'ignore' };
    }

    const commentData = {
      externalCommentId: comment.id.toString(),
      body: comment.body,
      authorLogin: sender.login,
      authorId: sender.id,
      url: comment.html_url,
      issueNumber: issue.number,
    };

    switch (action) {
      case 'created':
        return { action: 'sync_comment', commentData };

      case 'edited':
        return { action: 'update_comment', commentData };

      case 'deleted':
        return { action: 'delete_comment', commentData };

      default:
        return { action: 'ignore' };
    }
  }

  /**
   * Handle GitHub pull request events.
   */
  async handlePREvent(
    payload: GitHubPRWebhookPayload,
    config: GitHubConfig
  ): Promise<WebhookResult> {
    const { action, pull_request, repository } = payload;

    // Verify this is for the configured repository
    if (repository.owner.login !== config.owner || repository.name !== config.repo) {
      return { action: 'ignore' };
    }

    // Check if PR title or body contains a task reference (e.g., FLOW-123)
    const taskRef = this.extractTaskReference(pull_request.title + ' ' + (pull_request.body || ''));

    if (!taskRef) {
      // No task reference found, just create a link if it's a new PR
      if (action === 'opened') {
        return {
          action: 'link_task',
          externalLink: {
            type: 'github_pr',
            id: pull_request.number.toString(),
            url: pull_request.html_url,
          },
        };
      }
      return { action: 'ignore' };
    }

    switch (action) {
      case 'opened':
      case 'edited':
        return {
          action: 'link_task',
          taskId: taskRef,
          externalLink: {
            type: 'github_pr',
            id: pull_request.number.toString(),
            url: pull_request.html_url,
          },
        };

      case 'closed':
        // If merged, we might want to update the task status
        if (pull_request.merged) {
          return {
            action: 'update_task',
            taskId: taskRef,
            externalLink: {
              type: 'github_pr',
              id: pull_request.number.toString(),
              url: pull_request.html_url,
            },
          };
        }
        return { action: 'ignore' };

      default:
        return { action: 'ignore' };
    }
  }

  /**
   * Extract task reference from text (e.g., "FLOW-123" from PR title).
   */
  private extractTaskReference(text: string): string | null {
    // Match patterns like FLOW-123, TASK-456, etc.
    const match = text.match(/\b([A-Z]+-\d+)\b/);
    return match ? match[1]! : null;
  }

  /**
   * Convert GitHub issue state to FlowTask state category.
   */
  getStateCategory(state: 'open' | 'closed'): 'backlog' | 'done' {
    return state === 'open' ? 'backlog' : 'done';
  }

  /**
   * Map GitHub labels to FlowTask priority.
   */
  mapLabelsToPriority(labels: Array<{ name: string }>): TaskPriority | null {
    const priorityLabels: Record<string, TaskPriority> = {
      'priority:urgent': 'urgent',
      'priority:high': 'high',
      'priority:medium': 'medium',
      'priority:low': 'low',
      urgent: 'urgent',
      high: 'high',
      medium: 'medium',
      low: 'low',
      'p0': 'urgent',
      'p1': 'high',
      'p2': 'medium',
      'p3': 'low',
    };

    for (const label of labels) {
      const normalizedName = label.name.toLowerCase();
      if (normalizedName in priorityLabels) {
        return priorityLabels[normalizedName]!;
      }
    }

    return null;
  }

  /**
   * Build task data from a GitHub issue.
   */
  buildTaskFromIssue(issue: GitHubIssueWebhookPayload['issue']): {
    title: string;
    description: string | null;
    priority: TaskPriority | null;
    externalId: string;
    externalUrl: string;
  } {
    return {
      title: issue.title,
      description: issue.body,
      priority: this.mapLabelsToPriority(issue.labels),
      externalId: issue.number.toString(),
      externalUrl: issue.html_url,
    };
  }
}
