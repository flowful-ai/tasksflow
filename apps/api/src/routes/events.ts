import { Hono } from 'hono';
import { getDatabase } from '@flowtask/database';
import { WorkspaceService } from '@flowtask/domain';
import { getCurrentUser, requireAuth } from '@flowtask/auth';
import { addClient, removeClient } from '../sse/manager.js';

const events = new Hono();
const db = getDatabase();
const workspaceService = new WorkspaceService(db);

// Heartbeat interval in milliseconds (10 seconds)
const HEARTBEAT_INTERVAL = 10000;

/**
 * SSE stream endpoint for real-time updates.
 * Clients connect to this endpoint with a workspaceId query parameter.
 */
events.get('/stream', requireAuth, async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.query('workspaceId');

  if (!workspaceId) {
    return c.json(
      { success: false, error: { code: 'MISSING_PARAM', message: 'workspaceId is required' } },
      400
    );
  }

  // Verify user has access to the workspace
  const roleResult = await workspaceService.getMemberRole(workspaceId, user.id);
  if (!roleResult.ok || !roleResult.value) {
    return c.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to access this workspace' } },
      403
    );
  }

  // Create SSE stream
  // Use closure variable to store cleanup function - cancel() receives `reason`, not controller
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      // Add client to workspace
      addClient(workspaceId, controller);

      // Send initial connection message
      const encoder = new TextEncoder();
      const connectMessage = `retry: 5000\nevent: connected\ndata: ${JSON.stringify({ workspaceId, timestamp: new Date().toISOString() })}\n\n`;
      controller.enqueue(encoder.encode(connectMessage));

      // Set up heartbeat to keep connection alive
      const heartbeatId = setInterval(() => {
        try {
          const heartbeat = `:heartbeat ${new Date().toISOString()}\n\n`;
          controller.enqueue(encoder.encode(heartbeat));
        } catch {
          // Connection closed, cleanup will happen in cancel
          clearInterval(heartbeatId);
        }
      }, HEARTBEAT_INTERVAL);

      // Store cleanup function in closure (accessible from cancel)
      cleanup = () => {
        clearInterval(heartbeatId);
        removeClient(workspaceId, controller);
      };
    },
    cancel() {
      // Clean up when client disconnects
      // Note: cancel() receives an optional `reason` parameter, NOT the controller
      cleanup?.();
    },
  });

  // Return SSE response
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
});

/**
 * Health check endpoint for SSE.
 */
events.get('/health', (c) => {
  return c.json({ status: 'ok', type: 'sse' });
});

export { events as eventRoutes };
