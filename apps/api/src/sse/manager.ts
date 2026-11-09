import { getAuthz } from '../lib/authorize.js';
import { RealtimeHub, type AccessResolver, type ClientHandle, type ClientRegistration, type PublishOptions } from './hub.js';
import { PostgresTransport } from './postgres-transport.js';
import type { EventPayload } from './wire.js';

/**
 * Process-wide realtime entry points. Events are filtered per client by
 * project access and fanned out across API instances with Postgres
 * LISTEN/NOTIFY (see hub.ts and postgres-transport.ts).
 */

const accessResolver: AccessResolver = {
  getRole: (workspaceId, userId) => getAuthz().getRole(workspaceId, userId),
  listAccessibleProjectIds: (workspaceId, userId, role) => getAuthz().listAccessibleProjectIds(workspaceId, userId, role),
  isSessionActive: (sessionId) => getAuthz().isSessionActive(sessionId),
  resolveTaskProjectId: (taskId) => getAuthz().getTaskProjectId(taskId),
};

let hub: RealtimeHub = new RealtimeHub({ resolver: accessResolver });
let started = false;

/**
 * Start heartbeats, revalidation and the cross-instance subscription.
 * Safe to call more than once; never throws (LISTEN failures are retried).
 */
export function initSSE(): void {
  if (started) return;
  started = true;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('[realtime] DATABASE_URL not set; realtime events stay on this instance');
  }
  hub = new RealtimeHub({
    resolver: accessResolver,
    transportFactory: url ? () => new PostgresTransport(url) : null,
  });
  hub
    .start()
    .then(() => console.log('SSE manager initialized with Postgres LISTEN/NOTIFY'))
    .catch((error: unknown) => console.error('[realtime] failed to start:', error));
}

/** Close every stream and the LISTEN connection (graceful shutdown). */
export async function shutdownSSE(): Promise<void> {
  started = false;
  await hub.stop();
}

/**
 * Publish an event to a workspace's realtime clients.
 *
 * The event is only delivered to clients that can access its project, taken
 * from `options.projectId`, else `data.projectId` / `data.project.id`, else
 * resolved from `data.taskId`. Events with no project go to every member.
 */
export function publishEvent<T extends EventPayload>(
  workspaceId: string,
  event: string,
  data: T,
  options?: PublishOptions
): void {
  hub.publishEvent(workspaceId, event, data, options);
}

/** Publish an event to all of one user's streams (any workspace). */
export function publishUserEvent<T extends EventPayload>(userId: string, event: string, data: T): void {
  hub.publishUserEvent(userId, event, data);
}

/** Immediately close a removed member's streams on every instance. */
export function notifyMemberRemoved(workspaceId: string, userId: string): void {
  hub.notifyMemberRemoved(workspaceId, userId);
}

/** Refresh cached project access after an ACL, role or project change. */
export function notifyAccessChanged(workspaceId: string, userId?: string): void {
  hub.notifyAccessChanged(workspaceId, userId ?? null);
}

export function registerClient(registration: ClientRegistration): ClientHandle {
  return hub.addClient(registration);
}

export function getWorkspaceClientCount(workspaceId: string): number {
  return hub.getWorkspaceClientCount(workspaceId);
}

export function getTotalClientCount(): number {
  return hub.getTotalClientCount();
}
