import type { IntegrationProvider, SlackConfig, WebhookResult, TaskNotification } from '../types.js';
import type { TaskEvent } from '@flowtask/shared';
import { SlackNotifier } from './notify.js';
import { createSlackClient } from './client.js';

/**
 * Slack integration provider.
 * Implements one-way notification: FlowTask → Slack
 */
export class SlackProvider implements IntegrationProvider<SlackConfig> {
  type = 'slack' as const;
  name = 'Slack';

  /**
   * Validate Slack configuration.
   */
  validateConfig(config: unknown): config is SlackConfig {
    if (!config || typeof config !== 'object') {
      return false;
    }

    const c = config as Record<string, unknown>;

    return (
      typeof c.teamId === 'string' &&
      c.teamId.length > 0 &&
      typeof c.channelId === 'string' &&
      c.channelId.length > 0 &&
      typeof c.channelName === 'string' &&
      c.channelName.length > 0
    );
  }

  /**
   * Slack doesn't receive webhooks for task creation (one-way notification).
   * This is here for interface compliance but always returns ignore.
   */
  async handleWebhook(payload: unknown, config: SlackConfig): Promise<WebhookResult> {
    // Slack integration is notification-only, no webhook handling
    return { action: 'ignore' };
  }

  /**
   * Send notifications to Slack when tasks are updated.
   */
  async notify(event: TaskEvent, config: SlackConfig): Promise<void> {
    try {
      const client = createSlackClient(config);
      const notifier = new SlackNotifier(client);

      // Convert TaskEvent to TaskNotification
      const notification = this.eventToNotification(event);
      if (notification) {
        await notifier.sendTaskNotification(notification);
      }
    } catch (error) {
      console.error('Failed to send Slack notification:', error);
      // Don't throw - notifications are best-effort
    }
  }

  /**
   * Check if the integration is properly configured.
   */
  isConfigured(config: SlackConfig): boolean {
    return (
      this.validateConfig(config) &&
      !!process.env.SLACK_BOT_TOKEN &&
      !!process.env.SLACK_SIGNING_SECRET
    );
  }

  /**
   * Convert a TaskEvent to a TaskNotification.
   */
  private eventToNotification(event: TaskEvent): TaskNotification | null {
    // Map event types to notification actions
    const actionMap: Record<string, TaskNotification['action']> = {
      created: 'created',
      updated: 'updated',
      moved: 'updated',
      commented: 'commented',
    };

    const action = actionMap[event.eventType];
    if (!action) {
      return null; // Don't notify for other events
    }

    // In a real implementation, we would fetch task details
    // For now, return a minimal notification
    return {
      taskId: event.taskId,
      taskTitle: 'Task', // Would be fetched from database
      taskUrl: `${process.env.WEB_URL || 'http://localhost:3000'}/tasks/${event.taskId}`,
      projectName: 'Project', // Would be fetched from database
      projectIdentifier: 'PROJ', // Would be fetched from database
      action,
      details: event.fieldName ? `${event.fieldName} changed` : undefined,
    };
  }
}
