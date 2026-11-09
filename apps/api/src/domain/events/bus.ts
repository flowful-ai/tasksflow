/**
 * Tiny typed in-process event bus for domain events.
 *
 * Services emit AFTER their transaction commits, so a listener never sees data
 * that could still roll back. Listeners run asynchronously and in isolation:
 * a throwing or rejecting listener is logged and never affects the emitter or
 * the other listeners. `domainEvents.idle()` resolves once every listener
 * started so far has settled (used by tests and graceful shutdown).
 *
 * This is in-process only. Cross-replica fan-out (SSE) is done by the
 * subscribers themselves (e.g. via Postgres NOTIFY).
 */
import type { DomainEventMap, DomainEventName } from './types.js';

export type DomainEventListener<K extends DomainEventName> = (
  payload: DomainEventMap[K]
) => void | Promise<void>;

type ListenerRegistry = { [K in DomainEventName]: Set<DomainEventListener<K>> };

function createRegistry(): ListenerRegistry {
  return {
    'task.created': new Set(),
    'task.updated': new Set(),
    'task.moved': new Set(),
    'task.deleted': new Set(),
    'task.restored': new Set(),
    'tasks.rekeyed': new Set(),
    'comment.created': new Set(),
    'comment.updated': new Set(),
    'comment.deleted': new Set(),
    'project.updated': new Set(),
    'member.joined': new Set(),
    'member.left': new Set(),
    'member.role_changed': new Set(),
    'workspace.deleted': new Set(),
  };
}

export class DomainEventBus {
  private listeners: ListenerRegistry = createRegistry();
  private pending = new Set<Promise<void>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends DomainEventName>(event: K, listener: DomainEventListener<K>): () => void {
    const set: Set<DomainEventListener<K>> = this.listeners[event];
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** Emit an event to every listener. Never throws. */
  emit<K extends DomainEventName>(event: K, payload: DomainEventMap[K]): void {
    const set: Set<DomainEventListener<K>> = this.listeners[event];
    if (set.size === 0) return;
    for (const listener of [...set]) {
      const run = (async () => {
        try {
          await listener(payload);
        } catch (error) {
          console.error(`[domain-events] listener for "${event}" failed:`, error);
        }
      })();
      this.pending.add(run);
      void run.finally(() => this.pending.delete(run));
    }
  }

  /** Number of listeners for an event (diagnostics/tests). */
  listenerCount(event: DomainEventName): number {
    return this.listeners[event].size;
  }

  /** Resolve once all listener invocations started so far (and any they trigger) have settled. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  /** Remove every listener (tests). */
  clear(): void {
    this.listeners = createRegistry();
  }
}

/** Where services send their events: the bus itself, or a buffer that flushes after commit. */
export interface DomainEventSink {
  emit<K extends DomainEventName>(event: K, payload: DomainEventMap[K]): void;
}

/**
 * Collects events emitted inside an outer transaction. `flush()` forwards them
 * to the bus once the transaction has committed; on rollback they are dropped.
 */
export class BufferedEventSink implements DomainEventSink {
  private queued: Array<() => void> = [];

  constructor(private readonly target: DomainEventSink) {}

  emit<K extends DomainEventName>(event: K, payload: DomainEventMap[K]): void {
    this.queued.push(() => this.target.emit(event, payload));
  }

  flush(): void {
    const queued = this.queued;
    this.queued = [];
    for (const send of queued) send();
  }
}

/** Process-wide bus used by all domain services. */
export const domainEvents = new DomainEventBus();
