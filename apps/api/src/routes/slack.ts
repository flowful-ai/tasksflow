import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { getDatabase, projectIntegrations } from '../db/index.js';
import { getCurrentSession } from '../auth/index.js';
import { UpdateSlackIntegrationSchema, parseSlackConfig, type SlackConfig } from '@flowtask/shared';
import {
  buildSlackAuthorizeUrl,
  createOAuthState,
  createSlackClient,
  decryptSecret,
  getEnvSlackBotToken,
  getSlackOAuthCredentials,
  readSecretEnv,
} from '../integrations/index.js';
import { requireProject, requireUser } from '../lib/authorize.js';
import { AppError, isAppError, handleRouteError } from '../lib/responses.js';

/**
 * Slack project settings (FlowTask → Slack notifications only).
 * Mounted from github.ts under /api/projects.
 */
const slack = new Hono();
slack.onError(handleRouteError);
const db = getDatabase();

/** Where Slack redirects after OAuth. Must match the Slack app's configured redirect URL. */
export function getSlackRedirectUri(): string {
  const explicit = readSecretEnv('SLACK_REDIRECT_URI');
  if (explicit) return explicit;
  const apiBase = (readSecretEnv('BETTER_AUTH_URL') ?? 'http://localhost:3001').replace(/\/+$/, '');
  return `${apiBase}/api/webhooks/slack/oauth`;
}

async function getSlackIntegration(projectId: string) {
  const [row] = await db
    .select()
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.projectId, projectId),
        eq(projectIntegrations.integrationType, 'slack')
      )
    );
  if (!row) return null;
  return { id: row.id, isEnabled: row.isEnabled, config: parseSlackConfig(row.config) };
}

function publicView(
  integration: { id: string; isEnabled: boolean; config: SlackConfig | null } | null
) {
  return {
    connected: Boolean(integration?.config),
    id: integration?.id ?? null,
    isEnabled: integration?.isEnabled ?? false,
    teamName: integration?.config?.teamName ?? null,
    channelId: integration?.config?.channelId ?? null,
    channelName: integration?.config?.channelName ?? null,
    notifications: integration?.config?.notifications ?? null,
    canConnect: getSlackOAuthCredentials() !== null,
  };
}

function botTokenFor(config: SlackConfig): string | undefined {
  return config.botTokenEncrypted ? decryptSecret(config.botTokenEncrypted) : getEnvSlackBotToken();
}

slack.get('/:projectId/slack', async (c) => {
  const projectId = c.req.param('projectId');
  await requireProject(c, projectId, 'project:read');
  return c.json({ success: true, data: publicView(await getSlackIntegration(projectId)) });
});

// Start the Slack OAuth install; the installer picks the channel in Slack's dialog.
slack.post('/:projectId/slack/install/start', async (c) => {
  const user = requireUser(c);
  const projectId = c.req.param('projectId');
  await requireProject(c, projectId, 'project:manage_integrations');

  const credentials = getSlackOAuthCredentials();
  if (!credentials)
    throw new AppError(
      400,
      'NOT_CONFIGURED',
      'Slack is not configured (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET)'
    );

  let sessionId: string;
  try {
    sessionId = getCurrentSession(c).id;
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'A browser session is required');
  }

  const state = await createOAuthState(db, {
    provider: 'slack',
    userId: user.id,
    sessionId,
    projectId,
  });
  return c.json({
    success: true,
    data: {
      url: buildSlackAuthorizeUrl({
        clientId: credentials.clientId,
        state,
        redirectUri: getSlackRedirectUri(),
      }),
    },
  });
});

slack.get('/:projectId/slack/channels', async (c) => {
  const projectId = c.req.param('projectId');
  await requireProject(c, projectId, 'project:manage_integrations');

  const integration = await getSlackIntegration(projectId);
  const token = integration?.config ? botTokenFor(integration.config) : undefined;
  if (!token) throw new AppError(404, 'NOT_CONNECTED', 'Slack is not connected for this project');

  try {
    const channels = await createSlackClient(token).listChannels();
    return c.json({ success: true, data: { channels } });
  } catch (error) {
    console.error('Slack channel listing failed:', error);
    throw new AppError(502, 'SLACK_ERROR', 'Failed to list Slack channels');
  }
});

slack.patch('/:projectId/slack', async (c) => {
  const projectId = c.req.param('projectId');
  await requireProject(c, projectId, 'project:manage_integrations');

  let body: unknown = null;
  try {
    body = await c.req.json();
  } catch {
    // handled by the schema check below
  }
  const parsed = UpdateSlackIntegrationSchema.safeParse(body);
  if (!parsed.success) throw new AppError(400, 'INVALID_BODY', 'Invalid Slack settings');

  const integration = await getSlackIntegration(projectId);
  if (!integration?.config)
    throw new AppError(404, 'NOT_CONNECTED', 'Slack is not connected for this project');
  const config = integration.config;
  const next: SlackConfig = {
    ...config,
    notifications: { ...config.notifications, ...parsed.data.notifications },
  };

  if (parsed.data.channelId && parsed.data.channelId !== config.channelId) {
    const token = botTokenFor(config);
    if (!token)
      throw new AppError(400, 'NOT_CONNECTED', 'Slack bot token missing; reconnect Slack');
    try {
      const client = createSlackClient(token);
      const channel = (await client.listChannels()).find((ch) => ch.id === parsed.data.channelId);
      if (!channel)
        throw new AppError(
          400,
          'INVALID_CHANNEL',
          'Channel not found or not visible to the FlowTask app'
        );
      if (!channel.isPrivate && !channel.isMember) await client.joinChannel(channel.id);
      next.channelId = channel.id;
      next.channelName = channel.name;
    } catch (error) {
      if (isAppError(error)) throw error;
      console.error('Slack channel update failed:', error);
      throw new AppError(502, 'SLACK_ERROR', 'Failed to verify the Slack channel');
    }
  }

  await db
    .update(projectIntegrations)
    .set({
      config: next,
      ...(parsed.data.isEnabled !== undefined ? { isEnabled: parsed.data.isEnabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(projectIntegrations.id, integration.id));

  return c.json({ success: true, data: publicView(await getSlackIntegration(projectId)) });
});

slack.delete('/:projectId/slack', async (c) => {
  const projectId = c.req.param('projectId');
  await requireProject(c, projectId, 'project:manage_integrations');

  await db
    .delete(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.projectId, projectId),
        eq(projectIntegrations.integrationType, 'slack')
      )
    );
  return c.json({ success: true });
});

export { slack as slackRoutes };
