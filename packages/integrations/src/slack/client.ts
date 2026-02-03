import { App } from '@slack/bolt';
import type { SlackConfig } from '../types.js';

/**
 * Slack client wrapper using Bolt for JavaScript.
 * Handles API calls and socket mode connections.
 */
export class SlackClient {
  private app: App;
  private config: SlackConfig;

  constructor(app: App, config: SlackConfig) {
    this.app = app;
    this.config = config;
  }

  /**
   * Send a message to the configured channel.
   */
  async sendMessage(text: string, blocks?: unknown[]): Promise<string> {
    const result = await this.app.client.chat.postMessage({
      channel: this.config.channelId,
      text,
      blocks: blocks as any,
    });

    return result.ts || '';
  }

  /**
   * Update an existing message.
   */
  async updateMessage(ts: string, text: string, blocks?: unknown[]): Promise<void> {
    await this.app.client.chat.update({
      channel: this.config.channelId,
      ts,
      text,
      blocks: blocks as any,
    });
  }

  /**
   * Add a reaction to a message.
   */
  async addReaction(ts: string, emoji: string): Promise<void> {
    await this.app.client.reactions.add({
      channel: this.config.channelId,
      timestamp: ts,
      name: emoji,
    });
  }

  /**
   * Get channel information.
   */
  async getChannelInfo(): Promise<{ name: string; id: string }> {
    const result = await this.app.client.conversations.info({
      channel: this.config.channelId,
    });

    return {
      name: (result.channel as any)?.name || this.config.channelName,
      id: this.config.channelId,
    };
  }

  /**
   * Get members of the channel.
   */
  async getChannelMembers(): Promise<string[]> {
    const result = await this.app.client.conversations.members({
      channel: this.config.channelId,
    });

    return result.members || [];
  }

  /**
   * Get user information.
   */
  async getUserInfo(userId: string): Promise<{ name: string; email?: string }> {
    const result = await this.app.client.users.info({
      user: userId,
    });

    return {
      name: (result.user as any)?.real_name || (result.user as any)?.name || 'Unknown',
      email: (result.user as any)?.profile?.email,
    };
  }

  /**
   * Get the Bolt App instance for advanced operations.
   */
  getApp(): App {
    return this.app;
  }

  /**
   * Get the configuration.
   */
  getConfig(): SlackConfig {
    return this.config;
  }
}

/**
 * Create a Slack client with the configured credentials.
 */
export function createSlackClient(config: SlackConfig): SlackClient {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const appToken = process.env.SLACK_APP_TOKEN;

  if (!botToken || !signingSecret) {
    throw new Error('Slack credentials not configured');
  }

  const app = new App({
    token: botToken,
    signingSecret,
    // Use socket mode if app token is provided
    socketMode: !!appToken,
    appToken: appToken || undefined,
  });

  return new SlackClient(app, config);
}

/**
 * Create a Slack client for a specific workspace.
 * In production, this would use the workspace's stored OAuth token.
 */
export function createSlackClientForWorkspace(
  workspaceToken: string,
  config: SlackConfig
): SlackClient {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!signingSecret) {
    throw new Error('Slack signing secret not configured');
  }

  const app = new App({
    token: workspaceToken,
    signingSecret,
  });

  return new SlackClient(app, config);
}
