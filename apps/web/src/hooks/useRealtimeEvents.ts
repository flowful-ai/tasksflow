/**
 * One SSE connection per tab (mount once, in Layout).
 *
 * - Relies on the browser's native EventSource reconnect (honouring the
 *   server's `retry:` hint) and never closes the stream on error. Only when the
 *   browser gives up (readyState CLOSED, e.g. a 401/403 on reconnect) is a new
 *   EventSource created, with exponential backoff.
 * - Publishes `connecting | live | reconnecting` to stores/realtime.ts.
 * - After a reconnect, invalidates every active query (events sent while we
 *   were offline are lost).
 * - Task events with a complete payload patch the caches in place; ids-only
 *   payloads and other events invalidate, batched and debounced (150 ms).
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../api/http';
import {
  REALTIME_EVENT_NAMES,
  actionsForEvent,
  createInvalidationBatcher,
  parseEventData,
  reconnectDelay,
  statusAfterError,
} from '../lib/realtime';
import { useRealtimeStore } from '../stores/realtime';
import { removeTaskEverywhere, upsertTaskEverywhere } from './queries/cacheUpdates';

export function useRealtimeEvents(workspaceId: string | null | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const { setStatus, markEvent } = useRealtimeStore.getState();
    if (!workspaceId) {
      setStatus('connecting');
      return;
    }

    const batcher = createInvalidationBatcher((keys) => {
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    });

    let source: EventSource | null = null;
    let everOpened = false;
    let needsResync = false;
    let attempt = 0;
    let retryTimer: number | null = null;
    let disposed = false;

    const handle = (event: string, raw: string) => {
      const data = parseEventData(raw);
      if (!data) return;
      markEvent();
      for (const action of actionsForEvent(event, data)) {
        switch (action.type) {
          case 'upsertTask':
            upsertTaskEverywhere(queryClient, action.task, { created: action.created });
            break;
          case 'removeTask':
            removeTaskEverywhere(queryClient, action.taskId);
            break;
          case 'invalidate':
            batcher.add(action.queryKey);
            break;
        }
      }
    };

    const connect = () => {
      if (disposed) return;
      setStatus(everOpened ? 'reconnecting' : 'connecting');
      const url = `${API_BASE_URL}/api/events/stream?workspaceId=${encodeURIComponent(workspaceId)}`;
      const es = new EventSource(url, { withCredentials: true });
      source = es;

      es.onopen = () => {
        attempt = 0;
        setStatus('live');
        if (needsResync) {
          needsResync = false;
          batcher.cancel();
          void queryClient.invalidateQueries({ refetchType: 'active' });
        }
        everOpened = true;
      };

      es.onerror = () => {
        if (everOpened) needsResync = true;
        setStatus(statusAfterError(es.readyState, everOpened));
        // CONNECTING: the browser retries by itself. Don't close it.
        if (es.readyState !== EventSource.CLOSED) return;
        // CLOSED: the browser gave up; open a new stream after a backoff.
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(connect, reconnectDelay(attempt++));
      };

      for (const name of REALTIME_EVENT_NAMES) {
        es.addEventListener(name, (e: MessageEvent<string>) => handle(name, e.data));
      }
    };

    // Coming back to the tab with a dead stream: retry now instead of waiting.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || source?.readyState !== EventSource.CLOSED) return;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      attempt = 0;
      connect();
    };
    document.addEventListener('visibilitychange', onVisible);

    connect();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      batcher.flush();
      source?.close();
      source = null;
    };
  }, [workspaceId, queryClient]);
}
