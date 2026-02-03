import type { SlackClient } from './client.js';
import type { TaskNotification } from '../types.js';

/**
 * Slack notification builder and sender.
 * Creates rich Block Kit messages for task notifications.
 */
export class SlackNotifier {
  constructor(private client: SlackClient) {}

  /**
   * Send a task notification to Slack.
   */
  async sendTaskNotification(notification: TaskNotification): Promise<string> {
    const blocks = this.buildTaskBlocks(notification);
    const text = this.buildPlainText(notification);

    return this.client.sendMessage(text, blocks);
  }

  /**
   * Send a daily digest of tasks.
   */
  async sendDigest(tasks: TaskNotification[]): Promise<string> {
    const blocks = this.buildDigestBlocks(tasks);
    const text = `Daily digest: ${tasks.length} task${tasks.length === 1 ? '' : 's'} updated`;

    return this.client.sendMessage(text, blocks);
  }

  /**
   * Build Block Kit blocks for a task notification.
   */
  private buildTaskBlocks(notification: TaskNotification): unknown[] {
    const actionEmoji = {
      created: ':sparkles:',
      updated: ':pencil2:',
      completed: ':white_check_mark:',
      commented: ':speech_balloon:',
    }[notification.action];

    const actionVerb = {
      created: 'created',
      updated: 'updated',
      completed: 'completed',
      commented: 'commented on',
    }[notification.action];

    const blocks: unknown[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${actionEmoji} *Task ${actionVerb}*`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*<${notification.taskUrl}|${notification.projectIdentifier}: ${notification.taskTitle}>*`,
        },
      },
    ];

    // Add details if present
    if (notification.details) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: notification.details,
          },
        ],
      });
    }

    // Add actor if present
    if (notification.actor) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `By ${notification.actor.name}`,
          },
        ],
      });
    }

    // Add action button
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View Task',
            emoji: true,
          },
          url: notification.taskUrl,
          action_id: 'view_task',
        },
      ],
    });

    return blocks;
  }

  /**
   * Build plain text fallback for notification.
   */
  private buildPlainText(notification: TaskNotification): string {
    const actionVerb = {
      created: 'created',
      updated: 'updated',
      completed: 'completed',
      commented: 'commented on',
    }[notification.action];

    let text = `Task ${actionVerb}: ${notification.projectIdentifier} - ${notification.taskTitle}`;

    if (notification.actor) {
      text += ` (by ${notification.actor.name})`;
    }

    return text;
  }

  /**
   * Build Block Kit blocks for a digest.
   */
  private buildDigestBlocks(tasks: TaskNotification[]): unknown[] {
    const blocks: unknown[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: ':clipboard: Daily Task Digest',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${tasks.length} task${tasks.length === 1 ? '' : 's'} were updated today.`,
        },
      },
      {
        type: 'divider',
      },
    ];

    // Group tasks by action
    const grouped = {
      created: tasks.filter((t) => t.action === 'created'),
      updated: tasks.filter((t) => t.action === 'updated'),
      completed: tasks.filter((t) => t.action === 'completed'),
      commented: tasks.filter((t) => t.action === 'commented'),
    };

    // Add sections for each action type
    for (const [action, actionTasks] of Object.entries(grouped)) {
      if (actionTasks.length === 0) continue;

      const emoji = {
        created: ':sparkles:',
        updated: ':pencil2:',
        completed: ':white_check_mark:',
        commented: ':speech_balloon:',
      }[action as TaskNotification['action']];

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji} *${action.charAt(0).toUpperCase() + action.slice(1)}* (${actionTasks.length})`,
        },
      });

      // List tasks (max 5 per section)
      const taskList = actionTasks
        .slice(0, 5)
        .map((t) => `• <${t.taskUrl}|${t.projectIdentifier}: ${t.taskTitle}>`)
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: taskList,
        },
      });

      if (actionTasks.length > 5) {
        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `_...and ${actionTasks.length - 5} more_`,
            },
          ],
        });
      }
    }

    return blocks;
  }

  /**
   * Build a simple text message for slash command responses.
   */
  buildCommandResponse(message: string): { text: string; response_type: 'in_channel' | 'ephemeral' } {
    return {
      text: message,
      response_type: 'ephemeral',
    };
  }

  /**
   * Build a task list for slash command responses.
   */
  buildTaskListResponse(
    tasks: Array<{ id: string; title: string; identifier: string; url: string }>
  ): unknown[] {
    if (tasks.length === 0) {
      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'No tasks found.',
          },
        },
      ];
    }

    const blocks: unknown[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Found ${tasks.length} task${tasks.length === 1 ? '' : 's'}:*`,
        },
      },
    ];

    for (const task of tasks.slice(0, 10)) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${task.url}|${task.identifier}: ${task.title}>`,
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View',
            emoji: true,
          },
          url: task.url,
          action_id: `view_task_${task.id}`,
        },
      });
    }

    if (tasks.length > 10) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_Showing first 10 of ${tasks.length} tasks_`,
          },
        ],
      });
    }

    return blocks;
  }
}
