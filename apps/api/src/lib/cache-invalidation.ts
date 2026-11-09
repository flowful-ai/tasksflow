/**
 * Cross-instance invalidation for small per-process caches.
 *
 * A cache registers how to drop an entry locally. `invalidateCache` drops it
 * here and asks the broadcaster (the realtime hub, over Postgres NOTIFY) to
 * tell the other API instances, which apply it with `applyRemoteInvalidation`.
 * Without a broadcaster (tests, scripts, no database URL) only the local entry
 * is dropped and the cache's TTL bounds staleness elsewhere.
 */

/** Drop one key, or everything when `key` is null. */
export type CacheInvalidationHandler = (key: string | null) => void;
export type CacheInvalidationBroadcaster = (cache: string, key: string | null) => void;

const handlers = new Map<string, CacheInvalidationHandler>();
let broadcaster: CacheInvalidationBroadcaster | null = null;

export function registerInvalidatedCache(cache: string, handler: CacheInvalidationHandler): void {
  handlers.set(cache, handler);
}

/** Install the broadcaster; returns the previous one. */
export function setCacheInvalidationBroadcaster(
  next: CacheInvalidationBroadcaster | null
): CacheInvalidationBroadcaster | null {
  const previous = broadcaster;
  broadcaster = next;
  return previous;
}

/** Invalidate `key` (or the whole cache) on this instance and every other one. */
export function invalidateCache(cache: string, key: string | null): void {
  handlers.get(cache)?.(key);
  broadcaster?.(cache, key);
}

/** Apply an invalidation received from another instance. */
export function applyRemoteInvalidation(cache: string, key: string | null): void {
  handlers.get(cache)?.(key);
}
