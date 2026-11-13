import { getDatabase, resolveDatabaseUrl } from '../db/client.js';
import { getAuthz } from '../lib/authorize.js';
import {
  applyRemoteInvalidation,
  setCacheInvalidationBroadcaster,
} from '../lib/cache-invalidation.js';
import {
  RealtimeHub,
  type AccessResolver,
  type ClientHandle,
  type ClientRegistration,
  type PublishScope,
} from './hub.js';
import { PostgresTransport } from './postgres-transport.js';
import type { EventPayload } from './wire.js';

/**
 * Process-wide realtime entry points. Events are filtered per client by
 * project access and fanned out across API instances with Postgres
 * LISTEN/NOTIFY (see hub.ts and postgres-transport.ts).
 */

const accessResolver: AccessResolver = {
  getRole: (workspaceId, userId) => getAuthz().getRole(workspaceId, userId),
  listAccessibleProjectIds: (workspaceId, userId, role) =>
    getAuthz().listAccessibleProjectIds(workspaceId, userId, role),
  activeSessionIds: (sessionIds) => getAuthz().activeSessionIds(sessionIds),
};

let hub: RealtimeHub = new RealtimeHub({ resolver: accessResolver });
let started = false;

// Per-process caches (e.g. "project has Slack") are invalidated on every
// instance through the same NOTIFY channel as realtime events.
setCacheInvalidationBroadcaster((cache, key) => {
  void hub.broadcastCacheInvalidation(cache, key);
});

/**
 * Start heartbeats, revalidation and the cross-instance subscription.
 * Safe to call more than once; never throws (LISTEN failures are retried).
 */
export function initSSE(): void {
  if (started) return;
  started = true;
  // Same resolution as the DB pool: DATABASE_URL, or one built from POSTGRES_*
  // (the prod compose passes the parts, not a URL).
  const url = resolveDatabaseUrl();
  if (!url) {
    console.warn('[realtime] no database URL configured; realtime events stay on this instance');
  }
  hub = new RealtimeHub({
    resolver: accessResolver,
    onCacheInvalidated: applyRemoteInvalidation,
    // NOTIFY goes through the app pool; the transport only adds the LISTEN connection.
    transportFactory: url
      ? () =>
          new PostgresTransport(url, async (channel, payload) => {
            await getDatabase().$client.notify(channel, payload);
          })
      : null,
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
 * Publish an event to a workspace's realtime clients: those who can access
 * `scope.projectId`, or every member for a 'workspace' event.
 */
export function publishEvent<T extends EventPayload>(
  workspaceId: string,
  event: string,
  data: T,
  scope: PublishScope
): void {
  hub.publishEvent(workspaceId, event, data, scope);
}

/** Publish an event to all of one user's streams (any workspace). */
export function publishUserEvent<T extends EventPayload>(
  userId: string,
  event: string,
  data: T
): void {
  hub.publishUserEvent(userId, event, data);
}

/** Immediately close a removed member's streams on every instance. */
export function notifyMemberRemoved(workspaceId: string, userId: string): void {
  hub.notifyMemberRemoved(workspaceId, userId);
}

/**
 * Refresh cached project access after an ACL, role or project change, here
 * and on every instance. Await it before publishing an event that depends on
 * the new access.
 */
export function notifyAccessChanged(workspaceId: string, userId?: string): Promise<void> {
  return hub.notifyAccessChanged(workspaceId, userId ?? null);
}

export function registerClient(registration: ClientRegistration): ClientHandle {
  return hub.addClient(registration);
}
