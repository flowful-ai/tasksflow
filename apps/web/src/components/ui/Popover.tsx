/**
 * Popover (Radix) for pickers and small forms anchored to a trigger:
 * Escape/click outside close it and focus returns to the trigger.
 *
 *   <Popover open={open} onOpenChange={setOpen}>
 *     <PopoverTrigger asChild><button>Labels</button></PopoverTrigger>
 *     <PopoverContent align="start" className="w-64" aria-label="Pick labels">…</PopoverContent>
 *   </Popover>
 */
import * as Radix from '@radix-ui/react-popover';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import clsx from 'clsx';

export const Popover = Radix.Root;
export const PopoverTrigger = Radix.Trigger;

export const PopoverContent = forwardRef<
  ElementRef<typeof Radix.Content>,
  ComponentPropsWithoutRef<typeof Radix.Content>
>(function PopoverContent(
  { className, sideOffset = 6, align = 'start', collisionPadding = 8, ...props },
  ref
) {
  return (
    <Radix.Portal>
      <Radix.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={collisionPadding}
        className={clsx(
          'z-60 rounded-xl border border-neutral-200 bg-white p-2 text-sm shadow-lg outline-hidden animate-scale-in [animation-duration:120ms]',
          className
        )}
        {...props}
      />
    </Radix.Portal>
  );
});
