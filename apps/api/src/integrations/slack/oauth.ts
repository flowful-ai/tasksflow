import { webApi } from '@slack/bolt';
import { readSecretEnv } from '../env.js';

/** Bot scopes FlowTask requests. `incoming-webhook` lets the installer pick the channel in Slack's UI. */
export const SLACK_BOT_SCOPES = ['chat:write', 'chat:write.public', 'channels:read', 'groups:read', 'incoming-webhook'];

export interface SlackOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export function getSlackOAuthCredentials(): SlackOAuthCredentials | null {
  const clientId = readSecretEnv('SLACK_CLIENT_ID');
  const clientSecret = readSecretEnv('SLACK_CLIENT_SECRET');
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function buildSlackAuthorizeUrl(params: { clientId: string; state: string; redirectUri: string }): string {
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('scope', SLACK_BOT_SCOPES.join(','));
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  return url.toString();
}

export interface SlackInstallation {
  teamId: string;
  teamName: string | null;
  botToken: string;
  botUserId: string | null;
  /** Channel chosen in Slack's install dialog (incoming-webhook scope). */
  channel: { id: string; name: string } | null;
}

export class SlackOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlackOAuthError';
  }
}

/** Exchange an OAuth code via `oauth.v2.access`. */
export async function exchangeSlackOAuthCode(params: {
  code: string;
  redirectUri: string;
  credentials: SlackOAuthCredentials;
  client?: webApi.WebClient;
}): Promise<SlackInstallation> {
  const client = params.client ?? new webApi.WebClient();
  let result: webApi.OauthV2AccessResponse;
  try {
    result = await client.oauth.v2.access({
      client_id: params.credentials.clientId,
      client_secret: params.credentials.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    });
  } catch (error) {
    throw new SlackOAuthError(`Slack OAuth exchange failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  if (!result.ok || !result.access_token || !result.team?.id) {
    throw new SlackOAuthError(`Slack OAuth exchange failed: ${result.error ?? 'missing bot token'}`);
  }
  if (result.token_type && result.token_type !== 'bot') {
    throw new SlackOAuthError('Slack OAuth did not return a bot token');
  }

  const webhook = result.incoming_webhook;
  return {
    teamId: result.team.id,
    teamName: result.team.name ?? null,
    botToken: result.access_token,
    botUserId: result.bot_user_id ?? null,
    channel:
      webhook?.channel_id ? { id: webhook.channel_id, name: (webhook.channel ?? webhook.channel_id).replace(/^#/, '') } : null,
  };
}
