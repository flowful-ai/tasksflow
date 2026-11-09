import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { sql } from 'drizzle-orm';
import { authMiddleware, getTrustedOrigins } from '@flowtask/auth';
import { getDatabase } from '@flowtask/database';
import { requestLogger } from './lib/request-logger.js';
import { securityHeaders } from './lib/security-headers.js';
import { isShuttingDown, withTimeout } from './lib/shutdown.js';
import { SpaServer, resolveWebDistDir } from './lib/spa.js';
import { handleRouteError } from './lib/responses.js';

// Import routes
import { authRoutes } from './routes/auth.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';
import { commentRoutes } from './routes/comments.js';
import { smartViewRoutes } from './routes/smart-views.js';
import { webhookRoutes } from './routes/webhooks.js';
import { publicRoutes } from './routes/public.js';
import { agentRoutes } from './routes/agents.js';
import { mcpSseRoutes } from './routes/mcp-sse.js';
import { mcpOAuthRoutes } from './routes/mcp-oauth.js';
import { mcpConnectionsRoutes } from './routes/mcp-connections.js';
import { workspaceAgentRoutes } from './routes/workspace-agents.js';
import { workspaceApiKeysRoutes } from './routes/workspace-api-keys.js';
import { eventRoutes } from './routes/events.js';
import { githubRoutes, githubPublicRoutes } from './routes/github.js';
import {
  invitationRoutes,
  publicInvitationRoutes,
  acceptInvitationRoutes,
} from './routes/invitations.js';
import { appAdminRoutes } from './routes/app-admin.js';
import {
  MCP_CANONICAL_PATH,
  MCP_LEGACY_PATH,
  McpOAuthService,
} from './services/mcp-oauth-service.js';
import { getBaseUrl } from './lib/base-url.js';
import { notificationRoutes } from './routes/notifications.js';
import { searchRoutes } from './routes/search.js';
import { taskBulkRoutes } from './routes/tasks-bulk.js';
import { taskRelationRoutes } from './routes/task-relations.js';
import { taskHistoryRoutes } from './routes/task-history.js';
import { trashRoutes } from './routes/trash.js';
import { outgoingWebhookRoutes } from './routes/outgoing-webhooks.js';

export interface CreatedApp {
  app: Hono;
  /** Directory of the built SPA the app serves, or null for an API-only run. */
  webDistDir: string | null;
}

/**
 * Build the Hono app: middleware, health, discovery, every router, error and
 * 404 handling. No side effects beyond constructing route modules, so tests
 * mount exactly what production serves (server, migrations and background
 * work start in index.ts).
 */
export function createApp(): CreatedApp {
  const isProduction = process.env.NODE_ENV === 'production';
  const app = new Hono();
  const mcpOAuthService = new McpOAuthService();
  const webDistDir = resolveWebDistDir();
  const spa = webDistDir ? new SpaServer(webDistDir) : null;

  // Global middleware
  app.use('*', requestLogger());
  app.use('*', securityHeaders(isProduction));
  // Same origins as Better Auth's trustedOrigins: WEB_URL/BETTER_AUTH_URL, plus localhost outside production.
  app.use('*', cors({ origin: getTrustedOrigins(), credentials: true }));

  const MB = 1024 * 1024;
  const payloadTooLarge = (c: Context) =>
    c.json(
      { success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } },
      413
    );
  const defaultBodyLimit = bodyLimit({ maxSize: 1 * MB, onError: payloadTooLarge });
  // GitHub webhook payloads (large pushes, PR bodies) can exceed 1MB.
  const webhookBodyLimit = bodyLimit({ maxSize: 5 * MB, onError: payloadTooLarge });
  app.use('*', (c, next) =>
    c.req.path.startsWith('/api/webhooks/') ? webhookBodyLimit(c, next) : defaultBodyLimit(c, next)
  );

  async function databaseReachable(): Promise<boolean> {
    let ok = false;
    await withTimeout(
      getDatabase()
        .execute(sql`SELECT 1`)
        .then(() => {
          ok = true;
        })
        .catch(() => undefined),
      2000,
      'health check query'
    );
    return ok;
  }

  // Liveness: the process is up and can reach Postgres.
  app.get('/health', async (c) => {
    const db = await databaseReachable();
    return c.json(
      {
        status: db ? 'ok' : 'error',
        database: db ? 'ok' : 'unreachable',
        timestamp: new Date().toISOString(),
      },
      db ? 200 : 503
    );
  });

  // Readiness: as /health, and not draining for shutdown.
  app.get('/ready', async (c) => {
    if (isShuttingDown()) return c.json({ status: 'shutting_down' }, 503);
    const db = await databaseReachable();
    return c.json({ status: db ? 'ready' : 'not_ready' }, db ? 200 : 503);
  });

  // Root-level GitHub App installation callback handler
  // GitHub redirects here when "OAuth during installation" is enabled
  // We detect installation_id and forward to the proper handler
  app.get('/', (c) => {
    const installationId = c.req.query('installation_id');
    const setupAction = c.req.query('setup_action');

    if (installationId && setupAction) {
      // This is a GitHub App installation callback, forward to our handler
      const url = new URL(c.req.url);
      const redirectUrl = `/api/github/callback${url.search}`;
      return c.redirect(redirectUrl);
    }

    if (spa) return spa.serveIndex(c);

    // No built SPA (API-only dev run): return API info
    return c.json({
      name: 'FlowTask API',
      status: 'ok',
      docs: '/health',
    });
  });

  // RFC 9728 protected resource metadata: one document per MCP path, each
  // naming the resource it was derived from (canonical /api/mcp, legacy /api/mcp/sse).
  app.get('/.well-known/oauth-protected-resource/api/mcp', (c) => {
    return c.json(
      mcpOAuthService.getProtectedResourceMetadata(getBaseUrl(c.req.raw), MCP_CANONICAL_PATH)
    );
  });

  app.get('/.well-known/oauth-protected-resource/api/mcp/sse', (c) => {
    return c.json(
      mcpOAuthService.getProtectedResourceMetadata(getBaseUrl(c.req.raw), MCP_LEGACY_PATH)
    );
  });

  app.get('/.well-known/oauth-protected-resource', (c) => {
    return c.json(
      mcpOAuthService.getProtectedResourceMetadata(getBaseUrl(c.req.raw), MCP_CANONICAL_PATH)
    );
  });

  app.get('/.well-known/oauth-authorization-server', (c) => {
    return c.json(mcpOAuthService.getAuthorizationServerMetadata(getBaseUrl(c.req.raw)));
  });

  // Auth routes (public, handled by Better Auth)
  app.route('/api/auth', authRoutes);

  // Public routes (no auth required)
  app.route('/api/public', publicRoutes);

  // Webhook routes (verified by signature)
  app.route('/api/webhooks', webhookRoutes);

  // GitHub public routes (callback handler, no auth required)
  app.route('/api/github', githubPublicRoutes);

  // Public invitation routes (get invitation by token, no auth required)
  app.route('/api', publicInvitationRoutes);

  // MCP SSE routes (handles its own token authentication)
  app.route('/api/mcp', mcpSseRoutes);
  app.route('/api/mcp', mcpOAuthRoutes);

  // SSE event routes (handles its own authentication for streaming)
  app.route('/api/events', eventRoutes);

  // Protected routes (require authentication)
  app.use('/api/*', authMiddleware);

  // Workstream-B routes. Mounted before the tasks/projects routers so
  // /api/tasks/bulk and the nested /:id/... paths are never shadowed.
  app.route('/api/tasks', taskBulkRoutes);
  app.route('/api/tasks', taskRelationRoutes);
  app.route('/api/tasks', taskHistoryRoutes);
  app.route('/api/projects', trashRoutes);
  app.route('/api/notifications', notificationRoutes);
  app.route('/api/search', searchRoutes);
  app.route('/api/outgoing-webhooks', outgoingWebhookRoutes);

  // API routes
  app.route('/api/workspaces', workspaceRoutes);
  app.route('/api/projects', projectRoutes);
  app.route('/api/workspaces', workspaceAgentRoutes); // Workspace agent routes nested under workspaces
  app.route('/api/workspaces', workspaceApiKeysRoutes);
  app.route('/api/workspaces', mcpConnectionsRoutes);
  app.route('/api', invitationRoutes); // Invitation routes under /api/workspaces/:workspaceId/invitations
  app.route('/api', acceptInvitationRoutes); // Accept invitation route (requires auth)
  app.route('/api/tasks', taskRoutes);
  app.route('/api/tasks', commentRoutes); // Comment routes nested under tasks
  app.route('/api/smart-views', smartViewRoutes);
  app.route('/api/agents', agentRoutes);
  app.route('/api/github', githubRoutes);
  app.route('/api/projects', githubRoutes); // GitHub routes nested under projects
  app.route('/api/app', appAdminRoutes);

  // Error handler: AppErrors and client errors keep their status; anything else is logged, generic 500.
  app.onError(handleRouteError);

  // 404 handler. Non-API GETs fall through to the SPA here (index.html for client
  // routes, files from the built web app), so it works whatever order routes are
  // mounted in.
  app.notFound(async (c) => {
    if (spa && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
      const response = await spa.respond(c, c.req.path);
      if (response) return response;
    }
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found',
        },
      },
      404
    );
  });

  return { app, webDistDir };
}
