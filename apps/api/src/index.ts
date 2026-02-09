import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { authMiddleware } from '@flowtask/auth';

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
import { eventRoutes } from './routes/events.js';
import { githubRoutes, githubPublicRoutes } from './routes/github.js';
import { invitationRoutes, publicInvitationRoutes, acceptInvitationRoutes } from './routes/invitations.js';
import { McpOAuthService } from './services/mcp-oauth-service.js';

// Import SSE manager
import { initSSE } from './sse/manager.js';

const app = new Hono();
const mcpOAuthService = new McpOAuthService();

// Global middleware
app.use('*', logger());
app.use('*', secureHeaders());
app.use(
  '*',
  cors({
    origin: [
      'http://localhost:3000',
      'http://localhost:5173',
      process.env.WEB_URL || '',
    ].filter(Boolean),
    credentials: true,
  })
);

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
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

  // Not a GitHub callback, return API info
  return c.json({
    name: 'FlowTask API',
    status: 'ok',
    docs: '/health'
  });
});

app.get('/.well-known/oauth-protected-resource/api/mcp/sse', (c) => {
  const url = new URL(c.req.url);
  const forwardedProto = c.req.header('x-forwarded-proto');
  const forwardedHost = c.req.header('x-forwarded-host');
  const protocol = forwardedProto || url.protocol.replace(':', '');
  const host = forwardedHost || url.host;
  const baseUrl = `${protocol}://${host}`;

  return c.json(mcpOAuthService.getProtectedResourceMetadata(baseUrl));
});

app.get('/.well-known/oauth-authorization-server', (c) => {
  const url = new URL(c.req.url);
  const forwardedProto = c.req.header('x-forwarded-proto');
  const forwardedHost = c.req.header('x-forwarded-host');
  const protocol = forwardedProto || url.protocol.replace(':', '');
  const host = forwardedHost || url.host;
  const baseUrl = `${protocol}://${host}`;

  return c.json(mcpOAuthService.getAuthorizationServerMetadata(baseUrl));
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

// API routes
app.route('/api/workspaces', workspaceRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/workspaces', workspaceAgentRoutes); // Workspace agent routes nested under workspaces
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

// Error handler
app.onError((err, c) => {
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

// 404 handler
app.notFound((c) => {
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

const server = Bun.serve({
  hostname,
  port,
  fetch: app.fetch,
  // Increase idle timeout for SSE connections (default is 10s which kills long-lived streams)
  idleTimeout: 255, // Maximum allowed value in Bun (in seconds)
});

console.log(`🚀 FlowTask API running at http://${hostname}:${server.port}`);

// Initialize SSE manager (same port as API)
initSSE();

export default app;
export { app };
