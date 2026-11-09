import clsx from 'clsx';
import { colorDot } from '../../lib/color';

export interface ColorDotProps {
  color: string | null | undefined;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  /** Set when the dot is the only carrier of meaning (rare: prefer visible text). */
  label?: string;
}

const SIZES = { xs: 'h-1.5 w-1.5', sm: 'h-2 w-2', md: 'h-2.5 w-2.5' } as const;

/** A user colour shown as a dot next to neutral text (labels, states, projects). */
export function ColorDot({ color, size = 'sm', className, label }: ColorDotProps) {
  return (
    <span
      className={clsx('inline-block shrink-0 rounded-full', SIZES[size], className)}
      style={colorDot(color)}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}
