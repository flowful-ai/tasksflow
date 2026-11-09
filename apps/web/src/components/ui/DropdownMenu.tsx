/**
 * Dropdown menu (Radix): keyboard navigation, typeahead, Escape, click outside
 * and focus restore. Replaces hand-rolled "click outside" menus.
 *
 *   <DropdownMenu>
 *     <DropdownMenuTrigger asChild><IconButton label="Task actions" icon={<MoreHorizontal />} /></DropdownMenuTrigger>
 *     <DropdownMenuContent align="end">
 *       <DropdownMenuItem icon={<Pencil />} shortcut="E" onSelect={edit}>Edit</DropdownMenuItem>
 *       <DropdownMenuSub>
 *         <DropdownMenuSubTrigger>Priority</DropdownMenuSubTrigger>
 *         <DropdownMenuSubContent>…</DropdownMenuSubContent>
 *       </DropdownMenuSub>
 *       <DropdownMenuSeparator />
 *       <DropdownMenuItem destructive onSelect={remove}>Delete</DropdownMenuItem>
 *     </DropdownMenuContent>
 *   </DropdownMenu>
 *
 * Context menus: control it with `open`/`onOpenChange` and anchor it with a
 * zero-size trigger placed at the pointer (see TaskContextMenu).
 */
import * as Radix from '@radix-ui/react-dropdown-menu';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { Check, ChevronRight } from 'lucide-react';

export const DropdownMenu = Radix.Root;
export const DropdownMenuTrigger = Radix.Trigger;
export const DropdownMenuGroup = Radix.Group;
export const DropdownMenuSub = Radix.Sub;
export const DropdownMenuRadioGroup = Radix.RadioGroup;

export type MenuTone = 'light' | 'dark';

const CONTENT_TONES: Record<MenuTone, string> = {
  light: 'border-neutral-200 bg-white text-neutral-700',
  dark: 'border-sidebar-border bg-sidebar-hover text-sidebar-text',
};

const ITEM_TONES: Record<MenuTone, string> = {
  light: 'data-[highlighted]:bg-neutral-100 data-[highlighted]:text-neutral-900',
  dark: 'data-[highlighted]:bg-sidebar-active data-[highlighted]:text-white',
};

const ITEM_BASE =
  'relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

export interface DropdownMenuContentProps extends ComponentPropsWithoutRef<typeof Radix.Content> {
  tone?: MenuTone;
}

export const DropdownMenuContent = forwardRef<ElementRef<typeof Radix.Content>, DropdownMenuContentProps>(
  function DropdownMenuContent({ className, tone = 'light', sideOffset = 6, collisionPadding = 8, ...props }, ref) {
    return (
      <Radix.Portal>
        <Radix.Content
          ref={ref}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          className={clsx(
            'z-[60] min-w-[11rem] overflow-hidden rounded-xl border p-1 shadow-lg animate-scale-in [animation-duration:120ms]',
            CONTENT_TONES[tone],
            className
          )}
          {...props}
        />
      </Radix.Portal>
    );
  }
);

export interface DropdownMenuItemProps extends ComponentPropsWithoutRef<typeof Radix.Item> {
  icon?: ReactNode;
  /** Display-only shortcut hint, e.g. "⌫". */
  shortcut?: string;
  destructive?: boolean;
  tone?: MenuTone;
}

export const DropdownMenuItem = forwardRef<ElementRef<typeof Radix.Item>, DropdownMenuItemProps>(function DropdownMenuItem(
  { className, icon, shortcut, destructive, tone = 'light', children, ...props },
  ref
) {
  return (
    <Radix.Item
      ref={ref}
      className={clsx(
        ITEM_BASE,
        ITEM_TONES[tone],
        destructive && 'text-primary-700 data-[highlighted]:bg-primary-50 data-[highlighted]:text-primary-800',
        className
      )}
      {...props}
    >
      {icon && (
        <span aria-hidden className="flex h-4 w-4 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <span className="ml-4 font-mono text-[11px] text-neutral-400">{shortcut}</span>}
    </Radix.Item>
  );
});

export const DropdownMenuCheckboxItem = forwardRef<
  ElementRef<typeof Radix.CheckboxItem>,
  ComponentPropsWithoutRef<typeof Radix.CheckboxItem> & { tone?: MenuTone }
>(function DropdownMenuCheckboxItem({ className, children, tone = 'light', ...props }, ref) {
  return (
    <Radix.CheckboxItem ref={ref} className={clsx(ITEM_BASE, ITEM_TONES[tone], 'pl-8', className)} {...props}>
      <span className="absolute left-2.5 flex h-4 w-4 items-center justify-center">
        <Radix.ItemIndicator>
          <Check className="h-4 w-4" aria-hidden />
        </Radix.ItemIndicator>
      </span>
      {children}
    </Radix.CheckboxItem>
  );
});

export const DropdownMenuRadioItem = forwardRef<
  ElementRef<typeof Radix.RadioItem>,
  ComponentPropsWithoutRef<typeof Radix.RadioItem> & { tone?: MenuTone }
>(function DropdownMenuRadioItem({ className, children, tone = 'light', ...props }, ref) {
  return (
    <Radix.RadioItem ref={ref} className={clsx(ITEM_BASE, ITEM_TONES[tone], 'pl-8', className)} {...props}>
      <span className="absolute left-2.5 flex h-4 w-4 items-center justify-center">
        <Radix.ItemIndicator>
          <Check className="h-4 w-4" aria-hidden />
        </Radix.ItemIndicator>
      </span>
      {children}
    </Radix.RadioItem>
  );
});

export const DropdownMenuSubTrigger = forwardRef<
  ElementRef<typeof Radix.SubTrigger>,
  ComponentPropsWithoutRef<typeof Radix.SubTrigger> & { icon?: ReactNode; tone?: MenuTone }
>(function DropdownMenuSubTrigger({ className, children, icon, tone = 'light', ...props }, ref) {
  return (
    <Radix.SubTrigger
      ref={ref}
      className={clsx(ITEM_BASE, ITEM_TONES[tone], 'data-[state=open]:bg-neutral-100', className)}
      {...props}
    >
      {icon && (
        <span aria-hidden className="flex h-4 w-4 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
      )}
      <span className="flex-1">{children}</span>
      <ChevronRight className="h-4 w-4 text-neutral-400" aria-hidden />
    </Radix.SubTrigger>
  );
});

export const DropdownMenuSubContent = forwardRef<
  ElementRef<typeof Radix.SubContent>,
  ComponentPropsWithoutRef<typeof Radix.SubContent> & { tone?: MenuTone }
>(function DropdownMenuSubContent({ className, tone = 'light', ...props }, ref) {
  return (
    <Radix.Portal>
      <Radix.SubContent
        ref={ref}
        sideOffset={4}
        className={clsx(
          'z-[61] min-w-[10rem] overflow-hidden rounded-xl border p-1 shadow-lg animate-scale-in [animation-duration:120ms]',
          CONTENT_TONES[tone],
          className
        )}
        {...props}
      />
    </Radix.Portal>
  );
});

export function DropdownMenuSeparator({ className, tone = 'light' }: { className?: string; tone?: MenuTone }) {
  return (
    <Radix.Separator
      className={clsx('my-1 h-px', tone === 'light' ? 'bg-neutral-200' : 'bg-sidebar-border', className)}
    />
  );
}

export function DropdownMenuLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Radix.Label className={clsx('px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400', className)}>
      {children}
    </Radix.Label>
  );
}
