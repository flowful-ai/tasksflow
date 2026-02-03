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

// Import WebSocket handler
import { setupWebSocket } from './websocket/handler.js';

const app = new Hono();

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

// Auth routes (public, handled by Better Auth)
app.route('/api/auth', authRoutes);

// Public routes (no auth required)
app.route('/api/public', publicRoutes);

// Webhook routes (verified by signature)
app.route('/api/webhooks', webhookRoutes);

// Protected routes (require authentication)
app.use('/api/*', authMiddleware);

// API routes
app.route('/api/workspaces', workspaceRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/tasks', taskRoutes);
app.route('/api/tasks', commentRoutes); // Comment routes nested under tasks
app.route('/api/smart-views', smartViewRoutes);
app.route('/api/agents', agentRoutes);
app.route('/api/mcp', mcpRoutes);

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

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`🚀 FlowTask API running at http://localhost:${server.port}`);

// Setup WebSocket on separate port for Bun
const wsPort = parseInt(process.env.WS_PORT || '3002', 10);
setupWebSocket(wsPort);

export default app;
export { app };
