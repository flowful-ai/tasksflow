import { Redis } from 'ioredis';
import type { ServerWebSocket } from 'bun';
import { WS_EVENTS } from '@flowtask/shared';

// Redis pub/sub for scaling across multiple servers
let publisher: Redis | null = null;
let subscriber: Redis | null = null;

// WebSocket data type
interface WebSocketData {
  userId: string;
  workspaceIds: Set<string>;
}

// Incoming message types
interface SubscribeMessage {
  type: typeof WS_EVENTS.SUBSCRIBE;
  workspaceId: string;
  userId: string;
}

interface UnsubscribeMessage {
  type: typeof WS_EVENTS.UNSUBSCRIBE;
  workspaceId: string;
}

interface PingMessage {
  type: typeof WS_EVENTS.PING;
}

interface GenericMessage {
  type: string;
}

type WebSocketMessage = SubscribeMessage | UnsubscribeMessage | PingMessage | GenericMessage;

// Type constraint for event payloads - must be an object (not primitive)
type EventPayload = object;

// Connected clients by workspace
const workspaceClients = new Map<string, Set<ServerWebSocket<WebSocketData>>>();

const OPEN = 1;

/**
 * Initialize Redis pub/sub for WebSocket scaling.
 */
function initRedis() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  if (!publisher) {
    publisher = new Redis(redisUrl);
    subscriber = new Redis(redisUrl);

    subscriber.subscribe('ws:events');
    subscriber.on('message', (channel, message) => {
      if (channel === 'ws:events') {
        try {
          const { workspaceId, event, data } = JSON.parse(message);
          broadcastToWorkspace(workspaceId, event, data, false);
        } catch (error) {
          console.error('Failed to parse Redis message:', error);
        }
      }
    });
  }
}

/**
 * Set up WebSocket server using Bun.
 */
export function setupWebSocket(port: number) {
  initRedis();

  const server = Bun.serve<WebSocketData>({
    port,
    fetch(req, server) {
      // Upgrade HTTP to WebSocket
      const url = new URL(req.url);
      if (url.pathname === '/ws') {
        const upgraded = server.upgrade(req, {
          data: {
            userId: '',
            workspaceIds: new Set<string>(),
          },
        });
        if (upgraded) {
          return undefined;
        }
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      return new Response('Not Found', { status: 404 });
    },
    websocket: {
      open(ws) {
        console.log('WebSocket client connected');
        ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
      },
      message(ws, message) {
        try {
          const data = JSON.parse(message.toString());
          handleMessage(ws, data);
        } catch (error) {
          console.error('WebSocket message error:', error);
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
      },
      close(ws) {
        console.log('WebSocket client disconnected');
        handleDisconnect(ws);
      },
    },
  });

  console.log(`🔌 WebSocket server running at ws://localhost:${server.port}/ws`);

  return server;
}

function isSubscribeMessage(data: WebSocketMessage): data is SubscribeMessage {
  return data.type === WS_EVENTS.SUBSCRIBE && 'workspaceId' in data && 'userId' in data;
}

function isUnsubscribeMessage(data: WebSocketMessage): data is UnsubscribeMessage {
  return data.type === WS_EVENTS.UNSUBSCRIBE && 'workspaceId' in data;
}

function isPingMessage(data: WebSocketMessage): data is PingMessage {
  return data.type === WS_EVENTS.PING;
}

/**
 * Handle incoming WebSocket messages.
 */
function handleMessage(ws: ServerWebSocket<WebSocketData>, data: WebSocketMessage) {
  const metadata = ws.data;
  if (!metadata) return;

  if (isSubscribeMessage(data)) {
    const { workspaceId, userId } = data;

    if (!workspaceId || !userId) {
      ws.send(JSON.stringify({ type: 'error', message: 'Missing workspaceId or userId' }));
      return;
    }

    // TODO: Verify user has access to workspace
    // For now, trust the client

    metadata.userId = userId;
    metadata.workspaceIds.add(workspaceId);

    // Add to workspace clients
    if (!workspaceClients.has(workspaceId)) {
      workspaceClients.set(workspaceId, new Set());
    }
    workspaceClients.get(workspaceId)!.add(ws);

    ws.send(JSON.stringify({ type: 'subscribed', workspaceId }));
    return;
  }

  if (isUnsubscribeMessage(data)) {
    const { workspaceId } = data;

    if (!workspaceId) {
      ws.send(JSON.stringify({ type: 'error', message: 'Missing workspaceId' }));
      return;
    }

    metadata.workspaceIds.delete(workspaceId);

    // Remove from workspace clients
    const clients = workspaceClients.get(workspaceId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) {
        workspaceClients.delete(workspaceId);
      }
    }

    ws.send(JSON.stringify({ type: 'unsubscribed', workspaceId }));
    return;
  }

  if (isPingMessage(data)) {
    ws.send(JSON.stringify({ type: WS_EVENTS.PONG, timestamp: new Date().toISOString() }));
    return;
  }

  ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${data.type}` }));
}

/**
 * Handle client disconnection.
 */
function handleDisconnect(ws: ServerWebSocket<WebSocketData>) {
  const metadata = ws.data;
  if (!metadata) return;

  // Remove from all workspace client lists
  for (const workspaceId of metadata.workspaceIds) {
    const clients = workspaceClients.get(workspaceId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) {
        workspaceClients.delete(workspaceId);
      }
    }
  }
}

/**
 * Broadcast to all clients in a workspace.
 */
function broadcastToWorkspace<T extends EventPayload>(workspaceId: string, event: string, data: T, publishToRedis = true) {
  const clients = workspaceClients.get(workspaceId);

  if (clients) {
    const message = JSON.stringify({ type: event, data, timestamp: new Date().toISOString() });

    for (const client of clients) {
      if (client.readyState === OPEN) {
        client.send(message);
      }
    }
  }

  // Publish to Redis for other servers
  if (publishToRedis && publisher) {
    publisher.publish('ws:events', JSON.stringify({ workspaceId, event, data }));
  }
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
