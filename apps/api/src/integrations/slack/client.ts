import { webApi, type types as slackTypes } from '@slack/bolt';
import { readSecretEnv } from '../env.js';

export type SlackBlock = slackTypes.KnownBlock;

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

/**
 * Thin wrapper over the Slack Web API client for the calls FlowTask makes
 * (notifications are one-way: FlowTask → Slack).
 */
export class SlackClient {
  constructor(private readonly web: webApi.WebClient) {}

  /** Post a message; returns its `ts`. */
  async postMessage(channel: string, text: string, blocks?: SlackBlock[]): Promise<string | null> {
    const result: webApi.ChatPostMessageResponse = await this.web.chat.postMessage({
      channel,
      text,
      ...(blocks ? { blocks } : {}),
      unfurl_links: false,
      unfurl_media: false,
    });
    return result.ts ?? null;
  }

  /** Public (and, with groups:read, private) channels the bot can see. First 1000. */
  async listChannels(): Promise<SlackChannel[]> {
    const channels: SlackChannel[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result: webApi.ConversationsListResponse = await this.web.conversations.list({
        exclude_archived: true,
        types: 'public_channel,private_channel',
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      for (const channel of result.channels ?? []) {
        if (channel.id && channel.name) {
          channels.push({
            id: channel.id,
            name: channel.name,
            isPrivate: channel.is_private === true,
            isMember: channel.is_member === true,
          });
        }
      }
      cursor = result.response_metadata?.next_cursor || undefined;
      if (!cursor) break;
    }
    return channels;
  }

  /** Channel name lookup (falls back to the id). */
  async getChannelName(channelId: string): Promise<string> {
    const result: webApi.ConversationsInfoResponse = await this.web.conversations.info({
      channel: channelId,
    });
    return result.channel?.name ?? channelId;
  }

  /** Join a public channel so the bot can post there. */
  async joinChannel(channelId: string): Promise<void> {
    await this.web.conversations.join({ channel: channelId });
  }
}

export function createSlackClient(botToken: string): SlackClient {
  return new SlackClient(new webApi.WebClient(botToken));
}

/** Instance-wide bot token for single-workspace self-hosting (SLACK_BOT_TOKEN), trimmed. */
export function getEnvSlackBotToken(): string | undefined {
  return readSecretEnv('SLACK_BOT_TOKEN');
}
