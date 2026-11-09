/**
 * Realtime connection UI (mockup sections 1 and 6).
 *
 *   <LiveIndicator suffix={`${total} tasks`} />  → "● Live · 128 tasks" (amber dot while reconnecting)
 *   <ReconnectingBanner />                       → shown only while reconnecting (Layout mounts it)
 */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useConnectionStatus } from '../../stores/realtime';
import { Banner } from '../ui/Banner';

const LABELS = { live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…' } as const;

export function LiveIndicator({ suffix, className }: { suffix?: string; className?: string }) {
  const status = useConnectionStatus();
  return (
    <span
      role="status"
      className={clsx('inline-flex items-center gap-1.5 text-xs text-neutral-500', className)}
    >
      <span
        aria-hidden
        className={clsx(
          'h-2 w-2 rounded-full',
          status === 'live'
            ? 'bg-emerald-600'
            : status === 'reconnecting'
              ? 'bg-amber-500 animate-pulse'
              : 'bg-neutral-300'
        )}
      />
      {LABELS[status]}
      {suffix && <span> · {suffix}</span>}
    </span>
  );
}

/**
 * "Reconnecting… changes will sync when the connection returns". Waits 2 s
 * before showing so a quick blip (or a server restart) doesn't flash it.
 */
export function ReconnectingBanner({
  delayMs = 2000,
  className,
}: {
  delayMs?: number;
  className?: string;
}) {
  const status = useConnectionStatus();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (status !== 'reconnecting') {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [status, delayMs]);

  if (!visible) return null;
  return (
    <Banner variant="warning" className={className}>
      Reconnecting… changes will sync when the connection returns
    </Banner>
  );
}
