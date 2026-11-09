import { Hono } from 'hono';
import { requireAuth } from '../auth/index.js';
import { getAuthz, requireSession, requireUser } from '../lib/authorize.js';
import { AppError, forbidden, handleRouteError } from '../lib/responses.js';
import { registerClient } from '../sse/manager.js';
import type { ClientHandle } from '../sse/hub.js';

const events = new Hono();
events.onError(handleRouteError);

/** Client reconnect delay advertised with the SSE `retry:` field. */
const RETRY_MS = 5000;
/** Close streams whose consumer stopped reading (queued chunks). */
const MAX_QUEUED_CHUNKS = 500;

const encoder = new TextEncoder();

/**
 * SSE stream endpoint for real-time updates.
 * Clients connect with a workspaceId query parameter. Events are filtered by
 * the caller's project access; membership and session are re-checked about
 * every minute, and removed members are disconnected immediately.
 */
events.get('/stream', requireAuth, async (c) => {
  const user = requireUser(c);
  const session = requireSession(c);
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) {
    throw new AppError(400, 'MISSING_PARAM', 'workspaceId is required');
  }

  const authz = getAuthz();
  const role = await authz.getRole(workspaceId, user.id);
  if (!role) {
    throw forbidden('Not authorized to access this workspace');
  }
  const projectIds = await authz.listAccessibleProjectIds(workspaceId, user.id, role);

  let handle: ClientHandle | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      handle = registerClient({
        userId: user.id,
        sessionId: session.id,
        workspaceId,
        role,
        projectIds,
        sink: {
          write(chunk) {
            if (closed) return false;
            if (controller.desiredSize !== null && controller.desiredSize < -MAX_QUEUED_CHUNKS) return false;
            try {
              controller.enqueue(chunk);
              return true;
            } catch {
              return false;
            }
          },
          close() {
            if (closed) return;
            closed = true;
            try {
              controller.close();
            } catch {
              // already closed by the client
            }
          },
        },
      });

      const connected = JSON.stringify({ workspaceId, timestamp: new Date().toISOString() });
      controller.enqueue(encoder.encode(`retry: ${RETRY_MS}\nevent: connected\ndata: ${connected}\n\n`));
    },
    cancel() {
      // The browser went away; cancel() receives a reason, not the controller.
      handle?.dispose();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
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
