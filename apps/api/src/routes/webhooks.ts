import { Hono } from 'hono';
import { getDatabase, projectIntegrations, projects, externalLinks, accounts, workspaceMembers } from '@flowtask/database';
import { eq, and } from 'drizzle-orm';
import { GitHubProvider, GitHubSyncService, SlackProvider } from '@flowtask/integrations';
import { TaskService, CommentService } from '@flowtask/domain';
import crypto from 'crypto';

// How recently a sync must have occurred to be considered "from us" (5 seconds)
const SYNC_LOOP_THRESHOLD_MS = 5000;

const webhooks = new Hono();
const db = getDatabase();
const taskService = new TaskService(db);
const commentService = new CommentService(db);
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
  if (!secret) {
    console.error('GITHUB_WEBHOOK_SECRET is not configured — rejecting webhook');
    return c.json({ error: 'Webhook verification not configured' }, 500);
  }
  if (!verifyGitHubSignature(body, signature, secret)) {
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

  // Filter to find matching integration by checking repositories array
  let matchingIntegration: (typeof integrations)[number] | undefined;
  let matchedInstallationId: number | undefined;

  for (const i of integrations) {
    const config = i.integration.config as {
      installationId?: number;
      repositories?: Array<{ owner: string; repo: string; installationId?: number }>;
      owner?: string;
      repo?: string;
    };

    // Check per-repo entries first (new model)
    const matchedRepo = config.repositories?.find((r) => r.owner === owner && r.repo === repo);
    if (matchedRepo) {
      matchingIntegration = i;
      matchedInstallationId = matchedRepo.installationId ?? config.installationId;
      break;
    }

    // Legacy: top-level owner/repo
    if (config.owner === owner && config.repo === repo) {
      matchingIntegration = i;
      matchedInstallationId = config.installationId;
      break;
    }
  }

  if (!matchingIntegration || !matchedInstallationId) {
    return c.json({ status: 'ignored', reason: 'No matching integration found' });
  }

  const config = {
    owner,
    repo,
    installationId: matchedInstallationId,
  };

  // Handle the webhook
  try {
    const result = await githubProvider.handleWebhook(payload, config);

    if (result.action === 'ignore') {
      return c.json({ status: 'ignored' });
    }

    // Check for sync loop: if we recently synced this issue from FlowTask, skip
    if (result.externalLink && (result.action === 'update_task' || result.action === 'create_task')) {
      const [existingLink] = await db
        .select({ lastSyncedAt: externalLinks.lastSyncedAt })
        .from(externalLinks)
        .where(
          and(
            eq(externalLinks.integrationId, matchingIntegration.integration.id),
            eq(externalLinks.externalType, 'github_issue'),
            eq(externalLinks.externalId, result.externalLink.id)
          )
        );

      if (existingLink?.lastSyncedAt) {
        const timeSinceSync = Date.now() - new Date(existingLink.lastSyncedAt).getTime();
        if (timeSinceSync < SYNC_LOOP_THRESHOLD_MS) {
          return c.json({
            status: 'ignored',
            reason: 'Recent sync detected, skipping to prevent loop'
          });
        }
      }
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

    // Handle comment sync actions
    if (result.commentData) {
      const { externalCommentId, body, authorLogin, authorId, issueNumber } = result.commentData;

      // Find the linked task via externalLinks table
      const [linkedTask] = await db
        .select({ taskId: externalLinks.taskId })
        .from(externalLinks)
        .where(
          and(
            eq(externalLinks.integrationId, matchingIntegration.integration.id),
            eq(externalLinks.externalType, 'github_issue'),
            eq(externalLinks.externalId, issueNumber.toString())
          )
        );

      if (!linkedTask) {
        return c.json({
          status: 'ignored',
          reason: 'Comment on unlinked issue'
        });
      }

      if (result.action === 'sync_comment') {
        // Try to match GitHub author to workspace member
        // The accounts table stores GitHub accountId (numeric as string) where providerId = 'github'
        const [matchedAccount] = await db
          .select({ userId: accounts.userId })
          .from(accounts)
          .innerJoin(
            workspaceMembers,
            eq(accounts.userId, workspaceMembers.userId)
          )
          .where(
            and(
              eq(accounts.providerId, 'github'),
              eq(accounts.accountId, authorId.toString()),
              eq(workspaceMembers.workspaceId, matchingIntegration.project.workspaceId)
            )
          );

        let content = body;
        let userId: string | null = null;

        if (matchedAccount) {
          // Matched user in workspace - use their ID
          userId = matchedAccount.userId;
        } else {
          // No matched user - add attribution
          content = `**@${authorLogin}** commented on GitHub:\n\n${body}`;
        }

        const createResult = await commentService.create({
          taskId: linkedTask.taskId,
          userId,
          content,
          externalCommentId,
        });

        if (!createResult.ok) {
          console.error('Failed to create synced comment:', createResult.error);
          return c.json({ error: 'Failed to sync comment' }, 500);
        }

        return c.json({
          status: 'processed',
          action: 'comment_synced',
          commentId: createResult.value.id,
          taskId: linkedTask.taskId,
        });
      }

      if (result.action === 'update_comment') {
        const updateResult = await commentService.updateExternal(externalCommentId, body);

        if (!updateResult.ok) {
          console.error('Failed to update synced comment:', updateResult.error);
          return c.json({ error: 'Failed to update comment' }, 500);
        }

        // Check if comment existed
        if (!updateResult.value) {
          return c.json({
            status: 'ignored',
            reason: 'Comment not found for update'
          });
        }

        return c.json({
          status: 'processed',
          action: 'comment_updated',
          commentId: updateResult.value.id,
          taskId: linkedTask.taskId,
        });
      }

      if (result.action === 'delete_comment') {
        const deleteResult = await commentService.deleteExternal(externalCommentId);

        if (!deleteResult.ok) {
          console.error('Failed to delete synced comment:', deleteResult.error);
          return c.json({ error: 'Failed to delete comment' }, 500);
        }

        return c.json({
          status: 'processed',
          action: 'comment_deleted',
          taskId: linkedTask.taskId,
        });
      }
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

  // Reject requests older than 5 minutes to prevent replay attacks
  const requestAge = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));
  if (requestAge > 300) {
    return c.json({ error: 'Request too old' }, 401);
  }

  // Get raw body for signature verification
  const body = await c.req.text();

  // Verify signature
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) {
    console.error('SLACK_SIGNING_SECRET is not configured — rejecting webhook');
    return c.json({ error: 'Webhook verification not configured' }, 500);
  }
  if (!verifySlackSignature(body, timestamp, signature, secret)) {
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
