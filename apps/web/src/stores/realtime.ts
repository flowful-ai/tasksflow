/**
 * Realtime connection state, written by useRealtimeEvents (mounted once in
 * Layout) and read by the "Live" dot and the "Reconnecting…" banner.
 *
 *   const status = useConnectionStatus();   // 'connecting' | 'live' | 'reconnecting'
 */
import { create } from 'zustand';
import type { ConnectionStatus } from '../lib/realtime';

export type { ConnectionStatus };

interface RealtimeState {
  status: ConnectionStatus;
  /** When the stream last (re)opened, ms since epoch. */
  connectedAt: number | null;
  /** When the last event arrived, ms since epoch. */
  lastEventAt: number | null;
  setStatus: (status: ConnectionStatus) => void;
  markEvent: () => void;
}

export const useRealtimeStore = create<RealtimeState>()((set) => ({
  status: 'connecting',
  connectedAt: null,
  lastEventAt: null,
  setStatus: (status) =>
    set((state) =>
      state.status === status ? state : { status, connectedAt: status === 'live' ? Date.now() : state.connectedAt }
    ),
  markEvent: () => set({ lastEventAt: Date.now() }),
}));

export function useConnectionStatus(): ConnectionStatus {
  return useRealtimeStore((state) => state.status);
}
