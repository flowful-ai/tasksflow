import clsx from 'clsx';
import type { HTMLAttributes } from 'react';

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** 'dark' for use on the sidebar or dark surfaces. */
  tone?: 'light' | 'dark';
}

/** A keyboard key, e.g. <Kbd>⌘K</Kbd>. Purely visual; describe shortcuts in text or aria-keyshortcuts. */
export function Kbd({ tone = 'light', className, children, ...props }: KbdProps) {
  return (
    <kbd
      className={clsx(
        'inline-flex items-center rounded border border-b-2 px-[5px] py-[2px] font-mono text-[11px] leading-none',
        tone === 'light' ? 'border-neutral-300 bg-white text-neutral-600' : 'border-sidebar-border bg-sidebar-active text-sidebar-text',
        className
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
