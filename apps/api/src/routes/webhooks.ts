import { Hono } from 'hono';
import { getDatabase, projectIntegrations, projects } from '@flowtask/database';
import { eq, and } from 'drizzle-orm';
import { GitHubProvider, GitHubSyncService, SlackProvider } from '@flowtask/integrations';
import { TaskService } from '@flowtask/domain';
import crypto from 'crypto';

const webhooks = new Hono();
const db = getDatabase();
const taskService = new TaskService(db);
const githubProvider = new GitHubProvider();
const slackProvider = new SlackProvider();

// Verify GitHub webhook signature
function verifyGitHubSignature(payload: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

// Verify Slack request signature
function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string,
  secret: string
): boolean {
  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', secret);
  const mySignature = 'v0=' + hmac.update(baseString).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(mySignature));
}

// GitHub webhook endpoint
webhooks.post('/github', async (c) => {
  const signature = c.req.header('x-hub-signature-256');
  const event = c.req.header('x-github-event');
  const deliveryId = c.req.header('x-github-delivery');

  if (!signature || !event) {
    return c.json({ error: 'Missing required headers' }, 400);
  }

  // Get raw body for signature verification
  const body = await c.req.text();

  // Verify signature
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (secret && !verifyGitHubSignature(body, signature, secret)) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const payload = JSON.parse(body);

  // Extract repository info to find the integration
  const repoFullName = payload.repository?.full_name;
  if (!repoFullName) {
    return c.json({ status: 'ignored', reason: 'No repository in payload' });
  }

  const [owner, repo] = repoFullName.split('/');

  // Find the integration for this repository
  const integrations = await db
    .select({
      integration: projectIntegrations,
      project: projects,
    })
    .from(projectIntegrations)
    .innerJoin(projects, eq(projectIntegrations.projectId, projects.id))
    .where(
      and(
        eq(projectIntegrations.integrationType, 'github'),
        eq(projectIntegrations.isEnabled, true)
      )
    );

  // Filter to find matching integration
  const matchingIntegration = integrations.find((i) => {
    const config = i.integration.config as { owner: string; repo: string };
    return config.owner === owner && config.repo === repo;
  });

  if (!matchingIntegration) {
    return c.json({ status: 'ignored', reason: 'No matching integration found' });
  }

  const config = matchingIntegration.integration.config as {
    owner: string;
    repo: string;
    installationId: number;
  };

  // Handle the webhook
  try {
    const result = await githubProvider.handleWebhook(payload, config);

    if (result.action === 'ignore') {
      return c.json({ status: 'ignored' });
    }

    // Process based on action
    const syncService = new GitHubSyncService(db, taskService);

    if (result.action === 'create_task' && result.externalLink) {
      const issueNumber = parseInt(result.externalLink.id, 10);
      const syncResult = await syncService.syncIssue(
        matchingIntegration.integration.id,
        matchingIntegration.project.id,
        config,
        issueNumber
      );

      return c.json({
        status: 'processed',
        action: syncResult.action,
        taskId: syncResult.taskId,
      });
    }

    if (result.action === 'update_task' && result.externalLink) {
      const issueNumber = parseInt(result.externalLink.id, 10);
      const syncResult = await syncService.syncIssue(
        matchingIntegration.integration.id,
        matchingIntegration.project.id,
        config,
        issueNumber
      );

      return c.json({
        status: 'processed',
        action: syncResult.action,
        taskId: syncResult.taskId,
      });
    }

    if (result.action === 'link_task' && result.externalLink && result.taskId) {
      const prNumber = parseInt(result.externalLink.id, 10);
      await syncService.linkPullRequest(
        matchingIntegration.integration.id,
        result.taskId,
        prNumber,
        result.externalLink.url
      );

      return c.json({
        status: 'processed',
        action: 'linked',
        taskId: result.taskId,
      });
    }

    return c.json({ status: 'ignored' });
  } catch (error) {
    console.error('GitHub webhook error:', error);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

// Slack webhook endpoint (for slash commands and events)
webhooks.post('/slack', async (c) => {
  const timestamp = c.req.header('x-slack-request-timestamp');
  const signature = c.req.header('x-slack-signature');

  if (!timestamp || !signature) {
    return c.json({ error: 'Missing required headers' }, 400);
  }

  // Get raw body for signature verification
  const body = await c.req.text();

  // Verify signature
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (secret && !verifySlackSignature(body, timestamp, signature, secret)) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const payload = JSON.parse(body);

  // Handle URL verification challenge
  if (payload.type === 'url_verification') {
    return c.json({ challenge: payload.challenge });
  }

  // Handle slash commands
  if (payload.command) {
    const command = payload.command;
    const text = payload.text || '';

    // /task list - list tasks
    if (command === '/task' && text.startsWith('list')) {
      // TODO: Implement task listing for Slack
      return c.json({
        response_type: 'ephemeral',
        text: 'Task listing coming soon!',
      });
    }

    // /task view FLOW-123 - view a specific task
    if (command === '/task' && text.startsWith('view')) {
      const taskRef = text.split(' ')[1];
      // TODO: Implement task viewing for Slack
      return c.json({
        response_type: 'ephemeral',
        text: `Viewing task ${taskRef} coming soon!`,
      });
    }

    return c.json({
      response_type: 'ephemeral',
      text: 'Unknown command. Try `/task list` or `/task view FLOW-123`',
    });
  }

  // Handle events
  if (payload.event) {
    // Events are processed asynchronously, acknowledge immediately
    // In a production system, we would queue this for processing
    return c.json({ status: 'acknowledged' });
  }

  return c.json({ status: 'ignored' });
});

// Slack OAuth callback
webhooks.get('/slack/oauth', async (c) => {
  const code = c.req.query('code');

  if (!code) {
    return c.redirect(`${process.env.WEB_URL}/integrations/slack/error?reason=no_code`);
  }

  // TODO: Exchange code for token and store
  // This would involve calling Slack's oauth.v2.access endpoint

  return c.redirect(`${process.env.WEB_URL}/integrations/slack/success`);
});

export { webhooks as webhookRoutes };
