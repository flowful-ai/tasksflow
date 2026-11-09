import { SlackConfigSchema, type SlackConfig } from '@flowtask/shared';
import type { IntegrationProvider } from '../types.js';
import { getEnvSlackBotToken } from './client.js';

/**
 * Slack integration provider (config validation).
 * One-way: FlowTask → Slack notifications via notifySlackForTaskEvent.
 */
export class SlackProvider implements IntegrationProvider<SlackConfig> {
  type = 'slack' as const;
  name = 'Slack';

  validateConfig(config: unknown): config is SlackConfig {
    return SlackConfigSchema.safeParse(config).success;
  }

  isConfigured(config: SlackConfig): boolean {
    return (
      config.channelId.length > 0 &&
      (config.botTokenEncrypted !== undefined || getEnvSlackBotToken() !== undefined)
    );
  }
}
