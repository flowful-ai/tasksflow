import { randomUUID } from 'crypto';
import type { WorkspaceRole } from '@flowtask/shared';
import { isAdminRole } from '../domain/workspace/role-policy.js';
import {
  decodeWireMessage,
  encodeWithinLimit,
  formatSseFrame,
  toEventData,
  type EventPayload,
  type UserEventMessage,
  type WireMessage,
  type WorkspaceEventMessage,
} from './wire.js';

/**
 * Per-process realtime hub: tracks SSE clients, filters every event by the
 * client's project access, and fans events out to other API instances through
 * a pub/sub transport (Postgres LISTEN/NOTIFY in production).
 */

export interface RealtimeTransport {
  /** Start listening; `onMessage` receives raw payloads from every instance. */
  subscribe(onMessage: (payload: string) => void): Promise<void>;
  publish(payload: string): Promise<void>;
  close(): Promise<void>;
}

export interface AccessResolver {
  getRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null>;
  listAccessibleProjectIds(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole
  ): Promise<string[]>;
  isSessionActive(sessionId: string): Promise<boolean>;
}

export interface ClientSink {
  /** Write a chunk; return false when the stream is gone or backed up. */
  write(chunk: Uint8Array): boolean;
  /** Close the underlying stream (idempotent). */
  close(): void;
}

export interface ClientRegistration {
  userId: string;
  sessionId: string;
  workspaceId: string;
  role: WorkspaceRole;
  projectIds: readonly string[];
  sink: ClientSink;
}

export interface ClientHandle {
  readonly id: number;
  /** Remove the client (stream cancelled by the browser). */
  dispose(): void;
}

interface ClientState {
  id: number;
  userId: string;
  sessionId: string;
  workspaceId: string;
  role: WorkspaceRole;
  projectIds: Set<string>;
  sink: ClientSink;
  closed: boolean;
}

/**
 * Who may receive a workspace event: members who can access `projectId`, or
 * every member of the workspace ('workspace').
 */
export type PublishScope = { projectId: string } | 'workspace';

export interface HubTimings {
  heartbeatMs: number;
  revalidateMs: number;
  pingMs: number;
  /** Re-subscribe when no self-ping came back for this long. */
  listenStaleMs: number;
  reconnectDelayMs: number;
}

export const DEFAULT_TIMINGS: HubTimings = {
  heartbeatMs: 10_000,
  revalidateMs: 60_000,
  pingMs: 30_000,
  listenStaleMs: 95_000,
  reconnectDelayMs: 5_000,
};

export interface HubOptions {
  resolver: AccessResolver;
  transportFactory?: (() => RealtimeTransport) | null;
  timings?: Partial<HubTimings>;
  instanceId?: string;
  logger?: Pick<Console, 'error' | 'warn' | 'info'>;
}

const encoder = new TextEncoder();

export class RealtimeHub {
  readonly instanceId: string;
  private readonly resolver: AccessResolver;
  private readonly transportFactory: (() => RealtimeTransport) | null;
  private readonly timings: HubTimings;
  private readonly logger: Pick<Console, 'error' | 'warn' | 'info'>;

  private readonly clients = new Set<ClientState>();
  private readonly byWorkspace = new Map<string, Set<ClientState>>();
  private readonly byUser = new Map<string, Set<ClientState>>();
  private nextClientId = 1;
  private sequence = 0;

  private transport: RealtimeTransport | null = null;
  private subscribed = false;
  private connecting: Promise<void> | null = null;
  private lastPingAt = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private stopped = false;
  private revalidating = false;

  constructor(options: HubOptions) {
    this.resolver = options.resolver;
    this.transportFactory = options.transportFactory ?? null;
    this.timings = { ...DEFAULT_TIMINGS, ...options.timings };
    this.instanceId = options.instanceId ?? randomUUID();
    this.logger = options.logger ?? console;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Start timers and the cross-instance subscription. Never throws. */
  async start(): Promise<void> {
    this.stopped = false;
    this.timers.push(
      this.interval(() => this.heartbeat(), this.timings.heartbeatMs),
      this.interval(() => void this.revalidateAll(), this.timings.revalidateMs)
    );
    if (this.transportFactory) {
      this.timers.push(this.interval(() => void this.pingAndWatch(), this.timings.pingMs));
      await this.connect();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    for (const client of [...this.clients]) this.closeClient(client);
    await this.closeTransport();
  }

  isSubscribed(): boolean {
    return this.subscribed;
  }

  // ------------------------------------------------------------------ clients

  addClient(registration: ClientRegistration): ClientHandle {
    const client: ClientState = {
      id: this.nextClientId++,
      userId: registration.userId,
      sessionId: registration.sessionId,
      workspaceId: registration.workspaceId,
      role: registration.role,
      projectIds: new Set(registration.projectIds),
      sink: registration.sink,
      closed: false,
    };
    this.clients.add(client);
    this.index(this.byWorkspace, client.workspaceId, client);
    this.index(this.byUser, client.userId, client);
    return { id: client.id, dispose: () => this.removeClient(client) };
  }

  getWorkspaceClientCount(workspaceId: string): number {
    return this.byWorkspace.get(workspaceId)?.size ?? 0;
  }

  getTotalClientCount(): number {
    return this.clients.size;
  }

  // ------------------------------------------------------------------ publish

  /**
   * Publish a workspace event. A project-scoped event reaches only clients
   * that can access that project; a 'workspace' event reaches every member.
   */
  publishEvent(
    workspaceId: string,
    event: string,
    payload: EventPayload,
    scope: PublishScope
  ): void {
    void this.publishEventAsync(workspaceId, event, payload, scope).catch((error: unknown) => {
      this.logger.error('[realtime] publishEvent failed:', error);
    });
  }

  async publishEventAsync(
    workspaceId: string,
    event: string,
    payload: EventPayload,
    scope: PublishScope
  ): Promise<void> {
    const data = toEventData(payload);
    const projectId = scope === 'workspace' ? null : scope.projectId;

    const encoded = encodeWithinLimit<WorkspaceEventMessage>({
      k: 'ws',
      o: this.instanceId,
      id: this.nextEventId(),
      w: workspaceId,
      p: projectId,
      e: event,
      d: data,
    });
    if (!encoded) {
      this.logger.warn(`[realtime] dropping oversized ${event} event`);
      return;
    }

    this.deliverWorkspaceEvent(encoded.message);
    await this.broadcast(encoded.payload);
  }

  /** Publish an event to every stream of one user (e.g. notifications). */
  publishUserEvent(userId: string, event: string, payload: EventPayload): void {
    void this.publishUserEventAsync(userId, event, payload).catch((error: unknown) => {
      this.logger.error('[realtime] publishUserEvent failed:', error);
    });
  }

  async publishUserEventAsync(userId: string, event: string, payload: EventPayload): Promise<void> {
    const encoded = encodeWithinLimit<UserEventMessage>({
      k: 'user',
      o: this.instanceId,
      id: this.nextEventId(),
      u: userId,
      e: event,
      d: toEventData(payload),
    });
    if (!encoded) {
      this.logger.warn(`[realtime] dropping oversized ${event} user event`);
      return;
    }
    this.deliverUserEvent(encoded.message);
    await this.broadcast(encoded.payload);
  }

  /** Close a removed member's streams on this and every other instance. */
  notifyMemberRemoved(workspaceId: string, userId: string): void {
    this.closeMemberStreams(workspaceId, userId);
    void this.broadcast(
      JSON.stringify({ k: 'member_removed', o: this.instanceId, w: workspaceId, u: userId })
    );
  }

  /**
   * Project ACL, membership or role changed: refresh cached access for the
   * workspace's clients (or one user's) on every instance.
   */
  notifyAccessChanged(workspaceId: string, userId: string | null = null): void {
    void this.refreshAccess(workspaceId, userId);
    void this.broadcast(
      JSON.stringify({ k: 'access_changed', o: this.instanceId, w: workspaceId, u: userId })
    );
  }

  /** Handle a raw payload from the transport. Exposed for tests. */
  handleIncoming(payload: string): void {
    const message = decodeWireMessage(payload);
    if (!message) {
      this.logger.warn('[realtime] ignoring malformed message');
      return;
    }
    if (message.k === 'ping') {
      if (message.o === this.instanceId) this.lastPingAt = Date.now();
      return;
    }
    // Our own messages were already handled locally when published.
    if (message.o === this.instanceId) return;
    this.applyMessage(message);
  }

  /** Re-check every client's session, membership and access. Exposed for tests. */
  async revalidateAll(): Promise<void> {
    if (this.revalidating) return;
    this.revalidating = true;
    try {
      for (const client of [...this.clients]) {
        if (client.closed) continue;
        try {
          const active = await this.resolver.isSessionActive(client.sessionId);
          if (!active) {
            this.closeClient(client);
            continue;
          }
          await this.refreshClient(client);
        } catch (error) {
          // Transient DB failure: keep the stream, retry next round.
          this.logger.error('[realtime] revalidation failed:', error);
        }
      }
    } finally {
      this.revalidating = false;
    }
  }

  // ----------------------------------------------------------------- internal

  private applyMessage(message: WireMessage): void {
    switch (message.k) {
      case 'ws':
        this.deliverWorkspaceEvent(message);
        return;
      case 'user':
        this.deliverUserEvent(message);
        return;
      case 'member_removed':
        this.closeMemberStreams(message.w, message.u);
        return;
      case 'access_changed':
        void this.refreshAccess(message.w, message.u);
        return;
      case 'ping':
        return;
    }
  }

  private deliverWorkspaceEvent(message: WorkspaceEventMessage): void {
    const clients = this.byWorkspace.get(message.w);
    if (!clients) return;
    const chunk = encoder.encode(formatSseFrame(message.id, message.e, message.d));
    for (const client of [...clients]) {
      if (this.canReceive(client, message.p)) this.write(client, chunk);
    }
  }

  private deliverUserEvent(message: UserEventMessage): void {
    const clients = this.byUser.get(message.u);
    if (!clients) return;
    const chunk = encoder.encode(formatSseFrame(message.id, message.e, message.d));
    for (const client of [...clients]) this.write(client, chunk);
  }

  private canReceive(client: ClientState, projectId: string | null): boolean {
    if (projectId === null) return true;
    if (isAdminRole(client.role)) return true;
    return client.projectIds.has(projectId);
  }

  private write(client: ClientState, chunk: Uint8Array): void {
    if (client.closed) return;
    if (!client.sink.write(chunk)) this.closeClient(client);
  }

  private heartbeat(): void {
    if (this.clients.size === 0) return;
    const chunk = encoder.encode(`:heartbeat ${new Date().toISOString()}\n\n`);
    for (const client of [...this.clients]) this.write(client, chunk);
  }

  private closeMemberStreams(workspaceId: string, userId: string): void {
    const clients = this.byUser.get(userId);
    if (!clients) return;
    for (const client of [...clients]) {
      if (client.workspaceId === workspaceId) this.closeClient(client);
    }
  }

  private async refreshAccess(workspaceId: string, userId: string | null): Promise<void> {
    const clients = this.byWorkspace.get(workspaceId);
    if (!clients) return;
    for (const client of [...clients]) {
      if (userId !== null && client.userId !== userId) continue;
      try {
        await this.refreshClient(client);
      } catch (error) {
        this.logger.error('[realtime] access refresh failed:', error);
      }
    }
  }

  private async refreshClient(client: ClientState): Promise<void> {
    const role = await this.resolver.getRole(client.workspaceId, client.userId);
    if (!role) {
      this.closeClient(client);
      return;
    }
    const projectIds = await this.resolver.listAccessibleProjectIds(
      client.workspaceId,
      client.userId,
      role
    );
    client.role = role;
    client.projectIds = new Set(projectIds);
  }

  private closeClient(client: ClientState): void {
    this.removeClient(client);
    try {
      client.sink.close();
    } catch {
      // already closed
    }
  }

  private removeClient(client: ClientState): void {
    if (client.closed) return;
    client.closed = true;
    this.clients.delete(client);
    this.unindex(this.byWorkspace, client.workspaceId, client);
    this.unindex(this.byUser, client.userId, client);
  }

  private index(map: Map<string, Set<ClientState>>, key: string, client: ClientState): void {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(client);
  }

  private unindex(map: Map<string, Set<ClientState>>, key: string, client: ClientState): void {
    const set = map.get(key);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) map.delete(key);
  }

  private nextEventId(): string {
    this.sequence += 1;
    return `${this.instanceId.slice(0, 8)}-${this.sequence}`;
  }

  private interval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
    const timer = setInterval(() => {
      try {
        fn();
      } catch (error) {
        this.logger.error('[realtime] timer task failed:', error);
      }
    }, ms);
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref();
    return timer;
  }

  // ---------------------------------------------------------------- transport

  private async broadcast(payload: string): Promise<void> {
    const transport = this.transport;
    if (!transport || !this.subscribed) return;
    try {
      await transport.publish(payload);
    } catch (error) {
      this.logger.error('[realtime] NOTIFY failed:', error);
    }
  }

  private connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = this.connectLoop().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connectLoop(): Promise<void> {
    const factory = this.transportFactory;
    if (!factory) return;
    while (!this.stopped) {
      await this.closeTransport();
      const transport = factory();
      try {
        await transport.subscribe((payload) => this.handleIncoming(payload));
        this.transport = transport;
        this.subscribed = true;
        this.lastPingAt = Date.now();
        return;
      } catch (error) {
        this.logger.error('[realtime] LISTEN failed, retrying:', error);
        await transport.close().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, this.timings.reconnectDelayMs));
      }
    }
  }

  private async closeTransport(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    this.subscribed = false;
    if (transport) {
      await transport.close().catch((error: unknown) => {
        this.logger.error('[realtime] closing transport failed:', error);
      });
    }
  }

  /**
   * Self-ping through the transport. postgres.js re-listens after a dropped
   * connection but gives up silently if that fails, so a missing echo means
   * the subscription is dead and we rebuild it.
   */
  private async pingAndWatch(): Promise<void> {
    if (this.stopped || this.connecting) return;
    if (!this.subscribed || Date.now() - this.lastPingAt > this.timings.listenStaleMs) {
      this.logger.warn('[realtime] subscription stale, reconnecting');
      await this.connect();
      return;
    }
    await this.broadcast(JSON.stringify({ k: 'ping', o: this.instanceId }));
  }
}
