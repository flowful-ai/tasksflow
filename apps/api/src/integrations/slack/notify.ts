import type { TaskNotification } from '../types.js';
import type { SlackBlock, SlackClient } from './client.js';

/** Escape text for Slack mrkdwn so titles can't inject links or @mentions. */
export function escapeSlackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const ACTION_COPY: Record<TaskNotification['action'], { emoji: string; verb: string }> = {
  created: { emoji: ':sparkles:', verb: 'created' },
  state_changed: { emoji: ':arrow_right:', verb: 'moved' },
  assigned: { emoji: ':bust_in_silhouette:', verb: 'assigned' },
  commented: { emoji: ':speech_balloon:', verb: 'commented on' },
  completed: { emoji: ':white_check_mark:', verb: 'completed' },
  updated: { emoji: ':pencil2:', verb: 'updated' },
};

export interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

/** Build the Block Kit message for a task notification. */
export function buildTaskNotificationMessage(notification: TaskNotification): SlackMessage {
  const { emoji, verb } = ACTION_COPY[notification.action];
  const title = escapeSlackText(truncate(notification.taskTitle, 200));
  const key = escapeSlackText(notification.taskKey);
  const actor = notification.actorName ? escapeSlackText(notification.actorName) : null;

  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} ${actor ? `*${actor}* ${verb}` : `Task ${verb}`} *<${notification.taskUrl}|${key}: ${title}>*`,
      },
    },
  ];

  const contextParts = [escapeSlackText(notification.projectName)];
  if (notification.details) contextParts.push(escapeSlackText(truncate(notification.details, 500)));
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: contextParts.join(' · ') }] });

  const text = `${actor ? `${actor} ${verb}` : `Task ${verb}`}: ${key} ${title}`;
  return { text, blocks };
}

/**
 * Sends task notifications to one Slack channel.
 */
export class SlackNotifier {
  constructor(
    private readonly client: SlackClient,
    private readonly channelId: string
  ) {}

  async sendTaskNotification(notification: TaskNotification): Promise<string | null> {
    const message = buildTaskNotificationMessage(notification);
    return this.client.postMessage(this.channelId, message.text, message.blocks);
  }
}
