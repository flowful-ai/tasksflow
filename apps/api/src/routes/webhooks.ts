import { Hono } from 'hono';
import { and, eq, lt, sql } from 'drizzle-orm';
import { getDatabase, projectIntegrations, projects, webhookDeliveries } from '../db/index.js';
import { authMiddleware, getCurrentSession, getOptionalUser } from '../auth/index.js';
import { CommentService, TaskService } from '../domain/index.js';
import { GitHubWebhookEnvelopeSchema, type SlackConfig } from '@flowtask/shared';
import {
  GitHubWebhookProcessor,
  SlackOAuthError,
  consumeOAuthState,
  encryptSecret,
  exchangeSlackOAuthCode,
  findGitHubTargetsForRepo,
  getSlackOAuthCredentials,
  getWebUrl,
  parseGitHubWebhook,
  readSecretEnv,
  verifyGitHubSignature,
  verifySlackRequest,
  type WebhookTargetResult,
} from '../integrations/index.js';
import { getAuthz } from '../lib/authorize.js';
import { getSlackRedirectUri } from './slack.js';

const webhooks = new Hono();
const db = getDatabase();
const processor = new GitHubWebhookProcessor({
  db,
  taskService: new TaskService(db),
  commentService: new CommentService(db),
});

const DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastPruneAt = 0;

async function pruneDeliveries(): Promise<void> {
  if (Date.now() - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = Date.now();
  try {
    await db
      .delete(webhookDeliveries)
      .where(lt(webhookDeliveries.receivedAt, new Date(Date.now() - DELIVERY_RETENTION_MS)));
  } catch (error) {
    console.error('Failed to prune webhook deliveries:', error);
  }
}

function parseJson(body: string): unknown {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed;
  } catch {
    return null;
  }
}

// GitHub webhook endpoint
webhooks.post('/github', async (c) => {
  const signature = c.req.header('x-hub-signature-256');
  const event = c.req.header('x-github-event');
  const deliveryId = c.req.header('x-github-delivery');

  if (!signature || !event) {
    return c.json({ error: 'Missing required headers' }, 400);
  }

  const body = await c.req.text();
  const secret = readSecretEnv('GITHUB_WEBHOOK_SECRET');
  if (!secret) {
    console.error('GITHUB_WEBHOOK_SECRET is not configured — rejecting webhook');
    return c.json({ error: 'Webhook verification not configured' }, 500);
  }
  if (!verifyGitHubSignature(body, signature, secret)) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  if (event === 'ping') {
    return c.json({ status: 'pong' });
  }

  const payload = parseJson(body);
  const action = parseGitHubWebhook(event, payload);
  if (action.kind === 'ignore') {
    return c.json({ status: 'ignored', reason: action.reason });
  }

  const envelope = GitHubWebhookEnvelopeSchema.safeParse(payload);
  if (!envelope.success || !envelope.data.repository) {
    return c.json({ status: 'ignored', reason: 'No repository in payload' });
  }

  // Dedupe on X-GitHub-Delivery: GitHub retries and redeliveries reuse the id.
  if (deliveryId) {
    const [claimed] = await db
      .insert(webhookDeliveries)
      .values({ deliveryId })
      .onConflictDoNothing()
      .returning({ deliveryId: webhookDeliveries.deliveryId });
    if (!claimed) {
      return c.json({ status: 'ignored', reason: 'Duplicate delivery' });
    }
    void pruneDeliveries();
  }

  // Release the delivery id on any failure, so GitHub's retry or a manual
  // redelivery is processed instead of being treated as a duplicate.
  // Successful targets are idempotent (link claims, comment external ids, sync hashes).
  const releaseDelivery = async (): Promise<void> => {
    if (!deliveryId) return;
    try {
      await db.delete(webhookDeliveries).where(eq(webhookDeliveries.deliveryId, deliveryId));
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'github_webhook_release_failed',
          deliveryId,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  };

  try {
    const repository = envelope.data.repository;
    const targets = await findGitHubTargetsForRepo(db, repository.owner.login, repository.name);
    if (targets.length === 0) {
      return c.json({ status: 'ignored', reason: 'No matching integration found' });
    }

    // Deliver to every project that links this repository.
    const results: WebhookTargetResult[] = [];
    let failures = 0;
    for (const target of targets) {
      try {
        results.push(await processor.process(target, action));
      } catch (error) {
        failures++;
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'github_webhook_target_failed',
            deliveryId,
            event,
            integrationId: target.integrationId,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }

    if (failures > 0) {
      await releaseDelivery();
      return c.json({ error: 'Webhook processing failed', results }, 500);
    }

    const processed = results.some((r) => r.status === 'processed');
    return c.json({ status: processed ? 'processed' : 'ignored', results });
  } catch (error) {
    await releaseDelivery();
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'github_webhook_failed',
        deliveryId,
        event,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

/** Escape text for Slack mrkdwn. */
function slackEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function slackHelpText(teamId: string | null): Promise<string> {
  const webUrl = getWebUrl();
  const lines = [
    '*FlowTask for Slack* posts task notifications (created, moved, assigned, commented) to the channel chosen for each project.',
    'Tasks are managed in FlowTask; Slack is notification-only.',
  ];
  if (teamId) {
    const connected = await db
      .select({ projectId: projects.id, name: projects.name, identifier: projects.identifier })
      .from(projectIntegrations)
      .innerJoin(projects, eq(projectIntegrations.projectId, projects.id))
      .where(
        and(
          eq(projectIntegrations.integrationType, 'slack'),
          eq(projectIntegrations.isEnabled, true),
          sql`${projectIntegrations.config}->>'teamId' = ${teamId}`
        )
      )
      .limit(10);
    if (connected.length > 0) {
      lines.push('', '*Connected projects:*');
      for (const p of connected) {
        lines.push(
          `• <${webUrl}/project/${p.projectId}|${slackEscape(`${p.identifier} · ${p.name}`)}>`
        );
      }
    }
  }
  lines.push('', `<${webUrl}|Open FlowTask>`);
  return lines.join('\n');
}

// Slack request endpoint: URL verification and the /flowtask help command.
webhooks.post('/slack', async (c) => {
  const timestamp = c.req.header('x-slack-request-timestamp');
  const signature = c.req.header('x-slack-signature');
  if (!timestamp || !signature) {
    return c.json({ error: 'Missing required headers' }, 400);
  }

  const body = await c.req.text();
  const secret = readSecretEnv('SLACK_SIGNING_SECRET');
  if (!secret) {
    console.error('SLACK_SIGNING_SECRET is not configured — rejecting webhook');
    return c.json({ error: 'Webhook verification not configured' }, 500);
  }
  const verification = verifySlackRequest({ body, timestamp, signature, secret });
  if (!verification.ok) {
    return c.json(
      {
        error: verification.reason === 'stale_timestamp' ? 'Request too old' : 'Invalid signature',
      },
      401
    );
  }

  // Slash commands are form-encoded.
  if ((c.req.header('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
    const form = new URLSearchParams(body);
    if (form.get('command')) {
      return c.json({ response_type: 'ephemeral', text: await slackHelpText(form.get('team_id')) });
    }
    return c.json({ status: 'ignored' });
  }

  const payload = parseJson(body);
  if (
    payload &&
    typeof payload === 'object' &&
    'type' in payload &&
    payload.type === 'url_verification'
  ) {
    const challenge =
      'challenge' in payload && typeof payload.challenge === 'string' ? payload.challenge : '';
    return c.json({ challenge });
  }

  // FlowTask doesn't act on Slack events (one-way integration); acknowledge so Slack doesn't retry.
  return c.json({ status: 'acknowledged' });
});

// Slack OAuth callback (public route; runs the session middleware itself).
webhooks.get('/slack/oauth', authMiddleware, async (c) => {
  const webUrl = getWebUrl();
  const fail = (reason: string, projectId?: string) =>
    c.redirect(
      `${projectId ? `${webUrl}/project/${projectId}/settings` : `${webUrl}/projects`}?slack_error=${encodeURIComponent(reason)}`
    );

  const code = c.req.query('code');
  const state = c.req.query('state') ?? '';
  if (c.req.query('error')) return fail(c.req.query('error') ?? 'denied');
  if (!code || !state) return fail('no_code');

  const user = getOptionalUser(c);
  let sessionId: string | null = null;
  try {
    sessionId = getCurrentSession(c).id;
  } catch {
    sessionId = null;
  }
  if (!user || !sessionId) return fail('not_signed_in');

  const binding = await consumeOAuthState(db, state, 'slack');
  if (!binding) return fail('invalid_state');
  if (binding.userId !== user.id || binding.sessionId !== sessionId)
    return fail('session_mismatch', binding.projectId);

  const access = await getAuthz().authorizeProject(
    binding.projectId,
    user.id,
    'project:manage_integrations'
  );
  if (!access.ok) return fail('forbidden', binding.projectId);

  const credentials = getSlackOAuthCredentials();
  if (!credentials) return fail('not_configured', binding.projectId);

  try {
    const installation = await exchangeSlackOAuthCode({
      code,
      redirectUri: getSlackRedirectUri(),
      credentials,
    });
    if (!installation.channel) return fail('no_channel', binding.projectId);

    const config: SlackConfig = {
      teamId: installation.teamId,
      teamName: installation.teamName,
      channelId: installation.channel.id,
      channelName: installation.channel.name,
      botTokenEncrypted: encryptSecret(installation.botToken),
      botUserId: installation.botUserId,
      notifications: { taskCreated: true, stateChanged: true, assigned: true, commentAdded: true },
    };

    await db
      .insert(projectIntegrations)
      .values({ projectId: binding.projectId, integrationType: 'slack', config, isEnabled: true })
      .onConflictDoUpdate({
        target: [projectIntegrations.projectId, projectIntegrations.integrationType],
        set: { config, isEnabled: true, updatedAt: new Date(), syncError: null },
      });

    return c.redirect(
      `${webUrl}/project/${binding.projectId}/settings?section=slack&slack=connected`
    );
  } catch (error) {
    console.error('Slack OAuth failed:', error instanceof SlackOAuthError ? error.message : error);
    return fail('oauth_failed', binding.projectId);
  }
});

export { webhooks as webhookRoutes };
