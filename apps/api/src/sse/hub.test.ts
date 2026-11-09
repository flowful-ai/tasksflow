import { describe, expect, it } from 'bun:test';
import type { WorkspaceRole } from '@flowtask/shared';
import {
  RealtimeHub,
  deriveProjectId,
  type AccessResolver,
  type ClientSink,
  type RealtimeTransport,
} from './hub.js';
import {
  decodeWireMessage,
  encodeWithinLimit,
  SAFE_PAYLOAD_BYTES,
  toEventData,
  type WorkspaceEventMessage,
} from './wire.js';

const WS = 'ws-1';
const OPEN = 'project-open';
const SECRET = 'project-secret';

interface FakeState {
  roles: Map<string, WorkspaceRole>;
  access: Map<string, string[]>;
  sessions: Set<string>;
  taskProjects: Map<string, string>;
}

function fakeResolver(state: FakeState): AccessResolver {
  return {
    getRole: async (_workspaceId, userId) => state.roles.get(userId) ?? null,
    listAccessibleProjectIds: async (_workspaceId, userId) => state.access.get(userId) ?? [],
    isSessionActive: async (sessionId) => state.sessions.has(sessionId),
    resolveTaskProjectId: async (taskId) => state.taskProjects.get(taskId) ?? null,
  };
}

function recordingSink(): ClientSink & { frames: string[]; closed: boolean } {
  const decoder = new TextDecoder();
  const sink = {
    frames: [] as string[],
    closed: false,
    write(chunk: Uint8Array) {
      if (sink.closed) return false;
      sink.frames.push(decoder.decode(chunk));
      return true;
    },
    close() {
      sink.closed = true;
    },
  };
  return sink;
}

function events(sink: { frames: string[] }): string[] {
  return sink.frames
    .filter((f) => f.startsWith('id:'))
    .map((f) => /event: (.*)\n/.exec(f)?.[1] ?? '');
}

/** In-memory bus standing in for Postgres NOTIFY (delivers to every subscriber, sender included). */
function memoryBus() {
  const listeners = new Set<(payload: string) => void>();
  const sent: string[] = [];
  const factory = (): RealtimeTransport => {
    let mine: ((payload: string) => void) | null = null;
    return {
      async subscribe(onMessage) {
        mine = onMessage;
        listeners.add(onMessage);
      },
      async publish(payload) {
        sent.push(payload);
        for (const listener of listeners) listener(payload);
      },
      async close() {
        if (mine) listeners.delete(mine);
      },
    };
  };
  return { factory, sent };
}

function baseState(): FakeState {
  return {
    roles: new Map<string, WorkspaceRole>([
      ['member', 'member'],
      ['admin', 'admin'],
    ]),
    access: new Map([
      ['member', [OPEN]],
      ['admin', [OPEN, SECRET]],
    ]),
    sessions: new Set(['s-member', 's-admin']),
    taskProjects: new Map([['task-secret', SECRET]]),
  };
}

function register(hub: RealtimeHub, userId: string, role: WorkspaceRole, projectIds: string[]) {
  const sink = recordingSink();
  const handle = hub.addClient({
    userId,
    sessionId: `s-${userId}`,
    workspaceId: WS,
    role,
    projectIds,
    sink,
  });
  return { sink, handle };
}

describe('RealtimeHub project filtering', () => {
  it('never sends a member events for projects they cannot access', async () => {
    const hub = new RealtimeHub({ resolver: fakeResolver(baseState()) });
    const member = register(hub, 'member', 'member', [OPEN]);
    const admin = register(hub, 'admin', 'admin', [OPEN, SECRET]);

    await hub.publishEventAsync(WS, 'task:updated', { id: 't1', projectId: SECRET });
    await hub.publishEventAsync(WS, 'task:updated', { id: 't2', projectId: OPEN });

    expect(member.sink.frames.join('')).not.toContain('t1');
    expect(member.sink.frames.join('')).toContain('t2');
    expect(events(admin.sink)).toEqual(['task:updated', 'task:updated']);
  });

  it('derives the project from task payloads, explicit options and task lookups', async () => {
    const hub = new RealtimeHub({ resolver: fakeResolver(baseState()) });
    const member = register(hub, 'member', 'member', [OPEN]);

    await hub.publishEventAsync(WS, 'task:created', { id: 'nested', project: { id: SECRET } });
    await hub.publishEventAsync(WS, 'comment:created', {
      taskId: 'task-secret',
      comment: { id: 'c1' },
    });
    await hub.publishEventAsync(WS, 'task:updated', { id: 'explicit' }, { projectId: SECRET });
    await hub.publishEventAsync(WS, 'member:joined', { workspaceId: WS, userId: 'x' });

    expect(events(member.sink)).toEqual(['member:joined']);
  });

  it('frames events with id and event fields', async () => {
    const hub = new RealtimeHub({ resolver: fakeResolver(baseState()) });
    const member = register(hub, 'member', 'member', [OPEN]);
    await hub.publishEventAsync(WS, 'task:moved', { id: 't', projectId: OPEN });
    expect(member.sink.frames[0]).toMatch(
      /^id: [0-9a-f]{8}-1\nevent: task:moved\ndata: \{.*"timestamp"/
    );
  });

  it('delivers user events to every stream of that user only', async () => {
    const hub = new RealtimeHub({ resolver: fakeResolver(baseState()) });
    const member = register(hub, 'member', 'member', [OPEN]);
    const admin = register(hub, 'admin', 'admin', [OPEN, SECRET]);
    await hub.publishUserEventAsync('member', 'notification:created', { id: 'n1' });
    expect(events(member.sink)).toEqual(['notification:created']);
    expect(events(admin.sink)).toEqual([]);
  });
});

describe('RealtimeHub membership and access changes', () => {
  it('closes a removed member immediately, locally and on other instances', async () => {
    const bus = memoryBus();
    const state = baseState();
    const a = new RealtimeHub({
      resolver: fakeResolver(state),
      transportFactory: bus.factory,
      instanceId: 'aaaaaaaa-a',
    });
    const b = new RealtimeHub({
      resolver: fakeResolver(state),
      transportFactory: bus.factory,
      instanceId: 'bbbbbbbb-b',
    });
    await a.start();
    await b.start();
    try {
      const onA = register(a, 'member', 'member', [OPEN]);
      const onB = register(b, 'member', 'member', [OPEN]);

      a.notifyMemberRemoved(WS, 'member');
      await Bun.sleep(0);

      expect(onA.sink.closed).toBe(true);
      expect(onB.sink.closed).toBe(true);
      expect(b.getTotalClientCount()).toBe(0);
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it('revalidation closes streams of expired sessions and removed members, and refreshes access', async () => {
    const state = baseState();
    const hub = new RealtimeHub({ resolver: fakeResolver(state) });
    const member = register(hub, 'member', 'member', [OPEN]);
    const admin = register(hub, 'admin', 'admin', [OPEN, SECRET]);

    state.access.set('member', [OPEN, SECRET]);
    await hub.revalidateAll();
    await hub.publishEventAsync(WS, 'task:updated', { id: 'now-visible', projectId: SECRET });
    expect(member.sink.frames.join('')).toContain('now-visible');

    state.sessions.delete('s-member');
    state.roles.delete('admin');
    await hub.revalidateAll();
    expect(member.sink.closed).toBe(true);
    expect(admin.sink.closed).toBe(true);
    expect(hub.getTotalClientCount()).toBe(0);
  });
});

describe('RealtimeHub cross-instance delivery', () => {
  it('delivers once per instance and suppresses its own echo', async () => {
    const bus = memoryBus();
    const state = baseState();
    const a = new RealtimeHub({
      resolver: fakeResolver(state),
      transportFactory: bus.factory,
      instanceId: 'aaaaaaaa-a',
    });
    const b = new RealtimeHub({
      resolver: fakeResolver(state),
      transportFactory: bus.factory,
      instanceId: 'bbbbbbbb-b',
    });
    await a.start();
    await b.start();
    try {
      const onA = register(a, 'admin', 'admin', [OPEN, SECRET]);
      const onB = register(b, 'admin', 'admin', [OPEN, SECRET]);
      const memberOnB = register(b, 'member', 'member', [OPEN]);

      await a.publishEventAsync(WS, 'task:updated', { id: 't', projectId: SECRET });

      expect(events(onA.sink)).toEqual(['task:updated']);
      expect(events(onB.sink)).toEqual(['task:updated']);
      expect(events(memberOnB.sink)).toEqual([]);
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it('never throws when the transport fails', async () => {
    const failing = (): RealtimeTransport => ({
      subscribe: async () => undefined,
      publish: async () => {
        throw new Error('connection lost');
      },
      close: async () => undefined,
    });
    const errors: unknown[] = [];
    const hub = new RealtimeHub({
      resolver: fakeResolver(baseState()),
      transportFactory: failing,
      logger: {
        error: (...args: unknown[]) => errors.push(args),
        warn: () => undefined,
        info: () => undefined,
      },
    });
    await hub.start();
    try {
      const member = register(hub, 'member', 'member', [OPEN]);
      await hub.publishEventAsync(WS, 'task:updated', { id: 't', projectId: OPEN });
      expect(events(member.sink)).toEqual(['task:updated']);
      expect(errors.length).toBe(1);
    } finally {
      await hub.stop();
    }
  });

  it('keeps retrying LISTEN until it succeeds', async () => {
    let attempts = 0;
    const flaky = (): RealtimeTransport => ({
      subscribe: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('db down');
      },
      publish: async () => undefined,
      close: async () => undefined,
    });
    const hub = new RealtimeHub({
      resolver: fakeResolver(baseState()),
      transportFactory: flaky,
      timings: { reconnectDelayMs: 1 },
      logger: { error: () => undefined, warn: () => undefined, info: () => undefined },
    });
    await hub.start();
    expect(attempts).toBe(3);
    expect(hub.isSubscribed()).toBe(true);
    await hub.stop();
  });
});

describe('wire format', () => {
  it('sends ids only when the payload would exceed the NOTIFY limit', () => {
    const message: WorkspaceEventMessage = {
      k: 'ws',
      o: 'origin',
      id: 'x-1',
      w: WS,
      p: OPEN,
      e: 'task:updated',
      d: { id: 'task-1', projectId: OPEN, description: 'x'.repeat(10_000), comment: { id: 'c-9' } },
    };
    const encoded = encodeWithinLimit(message);
    expect(encoded).not.toBeNull();
    expect(Buffer.byteLength(encoded?.payload ?? '')).toBeLessThanOrEqual(SAFE_PAYLOAD_BYTES);
    expect(encoded?.message.d).toEqual({
      truncated: true,
      id: 'task-1',
      projectId: OPEN,
      commentId: 'c-9',
    });

    const small = encodeWithinLimit({ ...message, d: { id: 'task-1', projectId: OPEN } });
    expect(small?.message.d).toEqual({ id: 'task-1', projectId: OPEN });
  });

  it('rejects malformed payloads', () => {
    expect(decodeWireMessage('not json')).toBeNull();
    expect(decodeWireMessage(JSON.stringify({ k: 'ws', o: 'x' }))).toBeNull();
    const event = { k: 'ws', o: 'x', id: '1', w: WS, p: null, e: 'task:updated' };
    expect(decodeWireMessage(JSON.stringify({ ...event, d: ['not', 'an', 'object'] }))).toBeNull();
    expect(decodeWireMessage(JSON.stringify({ ...event, d: 'text' }))).toBeNull();
    const nested = { id: 't', project: { id: 'p', tags: ['a', 1, true, null] } };
    expect(decodeWireMessage(JSON.stringify({ ...event, d: nested }))).toMatchObject({ d: nested });
  });

  it('copies event payloads into JSON objects', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');
    expect(toEventData({ id: 't', at, skip: undefined, fn: () => 1, list: [1, 'a'] })).toEqual({
      id: 't',
      at: at.toISOString(),
      list: [1, 'a'],
    });
  });

  it('derives project ids from common payload shapes', () => {
    expect(deriveProjectId('task:created', { projectId: 'p' })).toBe('p');
    expect(deriveProjectId('task:created', { project: { id: 'p2' } })).toBe('p2');
    expect(deriveProjectId('project:updated', { id: 'p3' })).toBe('p3');
    expect(deriveProjectId('member:joined', { id: 'u' })).toBeNull();
  });
});
