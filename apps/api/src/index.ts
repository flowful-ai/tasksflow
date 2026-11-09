import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { sql } from 'drizzle-orm';
import { authMiddleware, getTrustedOrigins } from '@flowtask/auth';
import { closeDatabase, getDatabase, runMigrations } from '@flowtask/database';
import { applyClientIp, parseTrustedProxyHops, resolveClientIp } from './lib/client-ip.js';
import { resolveMigrationsDir, shouldRunMigrations } from './lib/migrations.js';
import { requestLogger } from './lib/request-logger.js';
import { securityHeaders } from './lib/security-headers.js';
import { isShuttingDown, markShuttingDown, registerShutdownHook, runShutdownHooks, withTimeout } from './lib/shutdown.js';
import { SpaServer, resolveWebDistDir } from './lib/spa.js';

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
import { mcpRoutes } from './routes/mcp.js';
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
import { MCP_CANONICAL_PATH, MCP_LEGACY_PATH, McpOAuthService } from './services/mcp-oauth-service.js';
import { getBaseUrl } from './lib/base-url.js';
import { notificationRoutes } from './routes/notifications.js';
import { searchRoutes } from './routes/search.js';
import { taskBulkRoutes } from './routes/tasks-bulk.js';
import { taskRelationRoutes } from './routes/task-relations.js';
import { taskHistoryRoutes } from './routes/task-history.js';
import { trashRoutes } from './routes/trash.js';
import { outgoingWebhookRoutes } from './routes/outgoing-webhooks.js';
import { startBackgroundServices } from '@flowtask/domain';

// Import SSE manager
import { initSSE } from './sse/manager.js';

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
  return c.json(mcpOAuthService.getProtectedResourceMetadata(getBaseUrl(c.req.raw), MCP_CANONICAL_PATH));
});

app.get('/.well-known/oauth-protected-resource/api/mcp/sse', (c) => {
  return c.json(mcpOAuthService.getProtectedResourceMetadata(getBaseUrl(c.req.raw), MCP_LEGACY_PATH));
});

app.get('/.well-known/oauth-protected-resource', (c) => {
  return c.json(mcpOAuthService.getProtectedResourceMetadata(getBaseUrl(c.req.raw), MCP_CANONICAL_PATH));
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
app.route('/api/mcp', mcpRoutes);
app.route('/api/github', githubRoutes);
app.route('/api/projects', githubRoutes); // GitHub routes nested under projects
app.route('/api/app', appAdminRoutes);

// Error handler
app.onError((err, c) => {
  if (err instanceof HTTPException && err.status < 500) {
    const code = err.status === 401 ? 'UNAUTHORIZED' : 'HTTP_ERROR';
    return c.json({ success: false, error: { code, message: err.message } }, err.status);
  }
  console.error('Server error:', err);
  return c.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
      },
    },
    500
  );
});

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

// Start server with Bun
const port = parseInt(process.env.API_PORT || '3001', 10);
const hostname = process.env.API_HOST || '0.0.0.0';
const trustedProxyHops = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);
const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000);

async function applyMigrations(): Promise<void> {
  if (!shouldRunMigrations(process.env.RUN_MIGRATIONS)) return;
  const dir = resolveMigrationsDir();
  if (!dir) {
    throw new Error('Migrations folder not found: set MIGRATIONS_DIR, or RUN_MIGRATIONS=false');
  }
  console.log(`Applying database migrations from ${dir}`);
  await runMigrations(dir);
}

function startServer(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname,
    port,
    fetch(req, server) {
      // Resolve the client IP once, from the proxy chain we trust, and overwrite
      // the forwarded headers so nothing downstream reads a spoofed value.
      const socketIp = server.requestIP(req)?.address ?? null;
      applyClientIp(
        req.headers,
        resolveClientIp(req.headers.get('x-forwarded-for'), socketIp, trustedProxyHops)
      );
      return app.fetch(req, server);
    },
    // Increase idle timeout for SSE connections (default is 10s which kills long-lived streams)
    idleTimeout: 255, // Maximum allowed value in Bun (in seconds)
  });
}

function installShutdownHandlers(server: ReturnType<typeof Bun.serve>): void {
  let started = false;
  const shutdown = async (signal: string) => {
    if (started) return;
    started = true;
    markShuttingDown();
    console.log(`${signal} received: draining`);
    // Stop accepting new connections; resolves once open ones have finished.
    const drained = server.stop();
    // SSE streams and background jobs end through their hooks.
    await runShutdownHooks(shutdownTimeoutMs);
    await withTimeout(drained, shutdownTimeoutMs, 'in-flight requests');
    await server.stop(true);
    await closeDatabase().catch((error: Error) => {
      console.error('Closing the database pool failed:', error.message);
    });
    console.log('Shutdown complete');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (import.meta.main) {
  try {
    await applyMigrations();
  } catch (error) {
    console.error('Database migration failed:', error);
    process.exit(1);
  }
  const server = startServer();
  installShutdownHandlers(server);
  console.log(
    `FlowTask API running at http://${hostname}:${server.port}` +
      (webDistDir ? ` (serving SPA from ${webDistDir})` : ' (no SPA build found)')
  );
  // Initialize SSE manager (same port as API)
  initSSE();
  // Domain-event subscribers + Postgres job runner, stopped on shutdown.
  const backgroundServices = startBackgroundServices(getDatabase());
  registerShutdownHook(() => backgroundServices.stop());
}

export default app;
export { app };
