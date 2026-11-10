/**
 * Accessible modal dialog (Radix): focus trap, Escape to close, click outside
 * to close, role="dialog" + aria-modal, title/description wiring, initial
 * focus and focus restore to the trigger on close.
 *
 *   <Dialog open={open} onOpenChange={setOpen} title="Edit label" description="…"
 *           footer={<><Button…/></>}>
 *     …form…
 *   </Dialog>
 *
 * Mounting it conditionally (`{open && <Dialog open onOpenChange={…} />}`) also
 * works: focus returns to the previously focused element on unmount.
 *
 * `variant="sheet"` docks it on the right (task detail). `bare` drops the
 * header/padding for custom layouts such as the ⌘K palette (the title stays
 * for screen readers).
 */
import * as RadixDialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useLayoutEffect, type ReactNode, type RefObject } from 'react';

/**
 * Focus restore that also covers dialogs unmounted while open (the common
 * `{open && <Dialog open … />}` pattern), where Radix can leave focus on
 * <body>: remember the focused element on open and return to it on close.
 */
function useReturnFocus(open: boolean): void {
  useLayoutEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    return () => {
      window.setTimeout(() => {
        const focusLost =
          document.activeElement === document.body || document.activeElement === null;
        if (focusLost && previous instanceof HTMLElement && previous.isConnected) previous.focus();
      }, 0);
    };
  }, [open]);
}

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required for accessibility; hide it visually with `hideTitle`. */
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Rendered in a bottom bar (buttons, right-aligned). */
  footer?: ReactNode;
  size?: DialogSize;
  variant?: 'center' | 'sheet';
  /** Element focused on open (default: the first focusable element). */
  initialFocus?: RefObject<HTMLElement | null>;
  hideTitle?: boolean;
  /** No header, padding or close button: `children` own the whole panel. */
  bare?: boolean;
  /** Prevent closing by Escape / outside click (e.g. while saving). */
  dismissible?: boolean;
  className?: string;
  /** Extra classes for the scrollable body. */
  bodyClassName?: string;
  /** Element rendered in the header next to the close button. */
  headerActions?: ReactNode;
}

const SIZE_CLASSES: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  full: 'max-w-5xl',
};

const SHEET_SIZE_CLASSES: Record<DialogSize, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-xl',
  xl: 'sm:max-w-2xl',
  full: 'sm:max-w-none',
};

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  variant = 'center',
  initialFocus,
  hideTitle = false,
  bare = false,
  dismissible = true,
  className,
  bodyClassName,
  headerActions,
}: DialogProps) {
  const preventIfLocked = (event: Event) => {
    if (!dismissible) event.preventDefault();
  };
  useReturnFocus(open);

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] animate-fade-in [animation-duration:150ms]" />
        <RadixDialog.Content
          aria-modal="true"
          onOpenAutoFocus={(event) => {
            if (initialFocus?.current) {
              event.preventDefault();
              initialFocus.current.focus();
            } else if (variant === 'sheet' && event.currentTarget instanceof HTMLElement) {
              // A sheet is a reading surface: focus the panel, not its first toolbar
              // button. Focusing a button opens its tooltip, which then swallows the
              // first Escape and leaves the sheet open.
              event.preventDefault();
              event.currentTarget.focus();
            }
          }}
          onEscapeKeyDown={(event) => {
            preventIfLocked(event);
            // Inline editors marked data-escape-cancels handle Escape themselves (cancel the edit).
            if (
              event.target instanceof HTMLElement &&
              event.target.closest('[data-escape-cancels]')
            )
              event.preventDefault();
          }}
          onPointerDownOutside={preventIfLocked}
          onInteractOutside={preventIfLocked}
          className={clsx(
            'fixed z-50 flex flex-col bg-white shadow-xl focus:outline-hidden',
            variant === 'center' && [
              // Centred with inset-0 + m-auto, not translate: the scale-in animation owns transform.
              'inset-0 m-auto h-fit w-[calc(100%-2rem)] max-h-[90vh] rounded-2xl animate-scale-in [animation-duration:150ms]',
              SIZE_CLASSES[size],
            ],
            variant === 'sheet' && ['inset-y-0 right-0 w-full', SHEET_SIZE_CLASSES[size]],
            className
          )}
        >
          {bare ? (
            <>
              <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="sr-only">{description}</RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only" />
              )}
              {children}
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
                <div className="min-w-0">
                  <RadixDialog.Title
                    className={clsx(
                      'text-lg font-semibold text-neutral-900',
                      hideTitle && 'sr-only'
                    )}
                  >
                    {title}
                  </RadixDialog.Title>
                  {description ? (
                    <RadixDialog.Description className="mt-1 text-sm text-neutral-500">
                      {description}
                    </RadixDialog.Description>
                  ) : (
                    <RadixDialog.Description className="sr-only" />
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {headerActions}
                  <RadixDialog.Close
                    aria-label="Close"
                    className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </RadixDialog.Close>
                </div>
              </div>
              <div className={clsx('min-h-0 flex-1 overflow-y-auto px-5 py-4', bodyClassName)}>
                {children}
              </div>
              {footer && (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3">
                  {footer}
                </div>
              )}
            </>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
