import { z } from 'zod';
import { readSecretEnv } from '../env.js';
import { SlackWebApi } from './web-api.js';

export type SlackTextObject = { type: 'mrkdwn' | 'plain_text'; text: string };

/** The Block Kit blocks FlowTask sends. */
export type SlackBlock =
  | { type: 'section'; text: SlackTextObject }
  | { type: 'context'; elements: SlackTextObject[] };

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

const PostMessageResponseSchema = z.object({ ts: z.string().nullish() });

const ConversationSchema = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  is_private: z.boolean().nullish(),
  is_member: z.boolean().nullish(),
});

const ConversationsListResponseSchema = z.object({
  channels: z.array(ConversationSchema).nullish(),
  response_metadata: z.object({ next_cursor: z.string().nullish() }).nullish(),
});

const ConversationsInfoResponseSchema = z.object({ channel: ConversationSchema.nullish() });

const EmptyResponseSchema = z.object({});

/**
 * Thin wrapper over the Slack Web API for the calls FlowTask makes
 * (notifications are one-way: FlowTask → Slack).
 */
export class SlackClient {
  constructor(private readonly web: SlackWebApi) {}

  /** Post a message; returns its `ts`. */
  async postMessage(channel: string, text: string, blocks?: SlackBlock[]): Promise<string | null> {
    const result = await this.web.call(
      'chat.postMessage',
      { channel, text, blocks, unfurl_links: false, unfurl_media: false },
      PostMessageResponseSchema
    );
    return result.ts ?? null;
  }

  /** Public (and, with groups:read, private) channels the bot can see. First 1000. */
  async listChannels(): Promise<SlackChannel[]> {
    const channels: SlackChannel[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await this.web.call(
        'conversations.list',
        { exclude_archived: true, types: 'public_channel,private_channel', limit: 200, cursor },
        ConversationsListResponseSchema
      );
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
    const result = await this.web.call(
      'conversations.info',
      { channel: channelId },
      ConversationsInfoResponseSchema
    );
    return result.channel?.name ?? channelId;
  }

  /** Join a public channel so the bot can post there. */
  async joinChannel(channelId: string): Promise<void> {
    await this.web.call('conversations.join', { channel: channelId }, EmptyResponseSchema);
  }
}

export function createSlackClient(botToken: string): SlackClient {
  return new SlackClient(new SlackWebApi({ token: botToken }));
}

/** Instance-wide bot token for single-workspace self-hosting (SLACK_BOT_TOKEN), trimmed. */
export function getEnvSlackBotToken(): string | undefined {
  return readSecretEnv('SLACK_BOT_TOKEN');
}
