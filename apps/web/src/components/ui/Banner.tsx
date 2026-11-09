import clsx from 'clsx';
import type { ReactNode } from 'react';

export type BannerVariant = 'warning' | 'info' | 'error' | 'success';

export interface BannerProps {
  variant?: BannerVariant;
  children: ReactNode;
  /** Optional trailing action (a button or link). */
  action?: ReactNode;
  /** Leading icon; defaults to a coloured status dot. */
  icon?: ReactNode;
  /** 'polite' announces changes to screen readers (default for warning/info); 'assertive' for errors. */
  live?: 'polite' | 'assertive' | 'off';
  className?: string;
}

const VARIANTS: Record<BannerVariant, { box: string; dot: string }> = {
  warning: { box: 'border-amber-300 bg-amber-50 text-amber-800', dot: 'bg-amber-600' },
  info: { box: 'border-blue-200 bg-blue-50 text-blue-800', dot: 'bg-blue-600' },
  error: { box: 'border-primary-200 bg-primary-50 text-primary-800', dot: 'bg-primary-600' },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-600' },
};

/**
 * Inline status banner (mockup section 6: "Reconnecting… changes will sync
 * when the connection returns").
 */
export function Banner({ variant = 'info', children, action, icon, live, className }: BannerProps) {
  const styles = VARIANTS[variant];
  const ariaLive = live ?? (variant === 'error' ? 'assertive' : 'polite');
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={ariaLive}
      className={clsx(
        'flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-[7px] text-[12.5px]',
        styles.box,
        className
      )}
    >
      {icon ?? <span aria-hidden className={clsx('h-2 w-2 shrink-0 rounded-full', styles.dot)} />}
      <span className="min-w-0">{children}</span>
      {action && <span className="ml-2 shrink-0">{action}</span>}
    </div>
  );
}
