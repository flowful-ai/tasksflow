/**
 * Toasts (sonner). Mount <Toaster /> once at the root (main.tsx does).
 *
 *   toast.success('Saved');            toast.error('Could not save');
 *   toastUndo('Deleted TF-12', () => restore(), { kbdHint: '⌘Z' });
 *
 * The undo toast follows mockup section 6: dark ink pill, bold coral "Undo",
 * optional key hint. Its Undo action is reachable with Tab and fires once.
 */
import { Toaster as SonnerToaster, toast } from 'sonner';
// Loaded as a file because the runtime <style> injection is stripped for CSP (see vite.config.ts).
import 'sonner/dist/styles.css';
import { Kbd } from './Kbd';

export { toast };

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      closeButton
      visibleToasts={4}
      toastOptions={{
        classNames: {
          toast:
            'font-sans !rounded-xl !border !border-neutral-200 !bg-white !text-neutral-900 !shadow-card-hover text-sm',
          title: '!font-semibold',
          description: '!text-neutral-500',
          error: '!border-primary-200',
          actionButton: '!bg-neutral-900 !text-white',
        },
      }}
    />
  );
}

export interface ToastUndoOptions {
  /** Secondary text, e.g. the task title. */
  description?: string;
  /** Key hint displayed next to Undo (display only, e.g. '⌘Z'). */
  kbdHint?: string;
  /** ms before the toast disappears and the action can no longer be undone (default 6000). */
  duration?: number;
  /** Shown after a successful undo (default "Restored"); pass null for none. */
  undoneMessage?: string | null;
}

/**
 * Show "message · Undo". `onUndo` may be async: the toast shows "Undoing…",
 * then success or an error toast. Returns the toast id (for toast.dismiss).
 */
export function toastUndo(message: string, onUndo: () => void | Promise<void>, options: ToastUndoOptions = {}): string | number {
  const { description, kbdHint, duration = 6000, undoneMessage = 'Restored' } = options;
  let used = false;

  const id = toast.custom(
    (toastId) => (
      <div
        role="status"
        className="flex items-center gap-3 rounded-[10px] bg-neutral-900 py-2.5 pl-3.5 pr-3 text-[13px] text-white shadow-[0_10px_24px_rgb(0_0_0/0.2)] font-sans"
      >
        <span className="min-w-0">
          <span className="block truncate">{message}</span>
          {description && <span className="block truncate text-xs text-neutral-400">{description}</span>}
        </span>
        <button
          type="button"
          className="ml-auto rounded px-1 font-bold text-primary-300 hover:text-primary-200 focus-visible:ring-primary-300"
          onClick={async () => {
            if (used) return;
            used = true;
            toast.dismiss(toastId);
            const pending = toast.loading('Undoing…');
            try {
              await onUndo();
              if (undoneMessage) toast.success(undoneMessage, { id: pending });
              else toast.dismiss(pending);
            } catch (error) {
              toast.error(error instanceof Error ? `Undo failed: ${error.message}` : 'Undo failed', { id: pending });
            }
          }}
        >
          Undo
        </button>
        {kbdHint && (
          <Kbd className="!border-neutral-600 !bg-transparent !text-neutral-400" aria-hidden>
            {kbdHint}
          </Kbd>
        )}
      </div>
    ),
    { duration, unstyled: true }
  );
  return id;
}
