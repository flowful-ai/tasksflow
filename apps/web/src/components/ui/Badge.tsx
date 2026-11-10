/**
 * Small status / tag pill.
 *
 *   <Badge>You</Badge>
 *   <Badge tone="success" shape="pill">This device</Badge>
 *   <Badge tone="outline" shape="pill" dot={label.color}>{label.name}</Badge>
 *   <Badge tone="primary" onRemove={() => remove(id)} removeLabel="Remove bug">bug</Badge>
 */
import type { HTMLAttributes, ReactNode } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { ColorDot } from './ColorDot';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'purple'
  | 'outline';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** 'square' (rounded corners, default) or 'pill' (fully rounded). */
  shape?: 'square' | 'pill';
  size?: 'xs' | 'sm';
  /** A user colour shown as a dot before the text. */
  dot?: string | null;
  icon?: ReactNode;
  /** Renders a small × button after the text. */
  onRemove?: () => void;
  removeLabel?: string;
}

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-100 text-neutral-600',
  primary: 'bg-primary-50 text-primary-700',
  success: 'bg-green-50 text-green-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700',
  info: 'bg-blue-50 text-blue-700',
  purple: 'bg-purple-50 text-purple-700',
  outline: 'border border-neutral-200 bg-white text-neutral-700',
};

const SIZES = {
  sm: 'px-2 py-0.5 text-xs',
  xs: 'px-1.5 py-px text-[11px]',
} as const;

export function Badge({
  tone = 'neutral',
  shape = 'square',
  size = 'sm',
  dot,
  icon,
  onRemove,
  removeLabel = 'Remove',
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex max-w-full items-center gap-1 whitespace-nowrap font-medium',
        shape === 'pill' ? 'rounded-full' : 'rounded-sm',
        SIZES[size],
        TONES[tone],
        className
      )}
      {...props}
    >
      {dot !== undefined && <ColorDot color={dot} />}
      {icon && (
        <span aria-hidden className="inline-flex shrink-0 [&>svg]:h-3 [&>svg]:w-3">
          {icon}
        </span>
      )}
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-0.5 rounded-full p-0.5 opacity-70 hover:bg-black/5 hover:opacity-100"
        >
          <X aria-hidden className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
