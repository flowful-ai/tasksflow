import { Redis } from 'ioredis';

// Type constraint for event payloads - must be an object (not primitive)
type EventPayload = object;

// Track SSE clients by workspace
const workspaceClients = new Map<string, Set<ReadableStreamDefaultController>>();

// Redis pub/sub for horizontal scaling
let publisher: Redis | null = null;
let subscriber: Redis | null = null;

/**
 * Initialize Redis pub/sub for SSE scaling across multiple servers.
 */
export function initSSE() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  if (!publisher) {
    publisher = new Redis(redisUrl);
    subscriber = new Redis(redisUrl);

    subscriber.subscribe('sse:events');
    subscriber.on('message', (channel, message) => {
      if (channel === 'sse:events') {
        try {
          const { workspaceId, event, data } = JSON.parse(message);
          broadcastToWorkspace(workspaceId, event, data, false);
        } catch (error) {
          console.error('Failed to parse Redis message:', error);
        }
      }
    });

    console.log('SSE manager initialized with Redis pub/sub');
  }
}

/**
 * Add a client to a workspace subscription.
 */
export function addClient(workspaceId: string, controller: ReadableStreamDefaultController) {
  if (!workspaceClients.has(workspaceId)) {
    workspaceClients.set(workspaceId, new Set());
  }
  workspaceClients.get(workspaceId)!.add(controller);
  console.log(`SSE client added to workspace ${workspaceId} (total: ${workspaceClients.get(workspaceId)!.size})`);
}

/**
 * Remove a client from a workspace subscription.
 */
export function removeClient(workspaceId: string, controller: ReadableStreamDefaultController) {
  const clients = workspaceClients.get(workspaceId);
  if (clients) {
    clients.delete(controller);
    console.log(`SSE client removed from workspace ${workspaceId} (remaining: ${clients.size})`);
    if (clients.size === 0) {
      workspaceClients.delete(workspaceId);
    }
  }
}

/**
 * Broadcast an event to all clients in a workspace.
 */
function broadcastToWorkspace<T extends EventPayload>(
  workspaceId: string,
  event: string,
  data: T,
  publishToRedis = true
) {
  const clients = workspaceClients.get(workspaceId);

  if (clients) {
    // Format as SSE message
    const message = formatSSEMessage(event, data);
    const encoder = new TextEncoder();
    const chunk = encoder.encode(message);

    // Send to all connected clients
    for (const controller of clients) {
      try {
        controller.enqueue(chunk);
      } catch {
        // Client disconnected, will be cleaned up
      }
    }
  }

  // Publish to Redis for other servers
  if (publishToRedis && publisher) {
    publisher.publish('sse:events', JSON.stringify({ workspaceId, event, data }));
  }
}

/**
 * Format a message as Server-Sent Events.
 */
function formatSSEMessage<T extends EventPayload>(event: string, data: T): string {
  return `event: ${event}\ndata: ${JSON.stringify({ ...data, timestamp: new Date().toISOString() })}\n\n`;
}

/**
 * Publish an event to a workspace.
 * This is the main function called by route handlers.
 */
export function publishEvent<T extends EventPayload>(workspaceId: string, event: string, data: T) {
  broadcastToWorkspace(workspaceId, event, data, true);
}

/**
 * Get the number of connected clients in a workspace.
 */
export function getWorkspaceClientCount(workspaceId: string): number {
  return workspaceClients.get(workspaceId)?.size || 0;
}

/**
 * Get total connected clients.
 */
export function getTotalClientCount(): number {
  let total = 0;
  for (const clients of workspaceClients.values()) {
    total += clients.size;
  }
  return total;
}
