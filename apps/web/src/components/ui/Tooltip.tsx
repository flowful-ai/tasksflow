/**
 * Tooltip (Radix). <TooltipProvider> is mounted once in main.tsx.
 *
 *   <Tooltip content="Archive" shortcut="E"><button aria-label="Archive">…</button></Tooltip>
 *
 * A tooltip is a visual hint only: the trigger still needs an accessible name
 * (use IconButton, which sets aria-label and the tooltip from one `label`).
 */
import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { Kbd } from './Kbd';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  );
}

export interface TooltipProps {
  content: ReactNode;
  /** The trigger: a single focusable element that accepts a ref. */
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Shown as a <Kbd> after the content, e.g. "C". */
  shortcut?: string;
  /** Render the trigger without a tooltip (e.g. when a menu is open). */
  disabled?: boolean;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  shortcut,
  disabled,
}: TooltipProps) {
  if (disabled) return <>{children}</>;
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          className="z-70 flex items-center gap-2 rounded-lg bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg animate-fade-in [animation-duration:120ms]"
        >
          {content}
          {shortcut && (
            <Kbd className="border-neutral-600! bg-neutral-800! text-neutral-300!">{shortcut}</Kbd>
          )}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
