/**
 * Confirmation dialog with an async confirm action.
 *
 *   <ConfirmDialog
 *     open={open} onOpenChange={setOpen}
 *     title="Delete 3 tasks?" description="They move to the trash for 30 days."
 *     confirmLabel="Delete" variant="danger"
 *     onConfirm={() => bulkDelete.mutateAsync(ids)}
 *   />
 *
 * While `onConfirm`'s promise is pending the confirm button shows a spinner
 * and the dialog cannot be dismissed. It closes when the promise resolves; on
 * rejection it stays open and shows the error message.
 *
 * Replaces window.confirm(). For single-task deletes prefer an undo toast.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { Dialog } from './Dialog';
import { Spinner } from './Spinner';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Extra content between the description and the buttons (e.g. a "type the name" input). */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void | Promise<void>;
  /** Disable the confirm button (e.g. until a confirmation input matches). */
  confirmDisabled?: boolean;
  /** Externally driven loading state (e.g. a mutation's isPending). */
  isLoading?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  confirmDisabled = false,
  isLoading = false,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const busy = pending || isLoading;

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleConfirm = async () => {
    setError(null);
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title={
        <span className="flex items-center gap-2">
          {variant === 'danger' && <AlertTriangle className="h-5 w-5 text-primary-600" aria-hidden />}
          {title}
        </span>
      }
      description={description}
      size="sm"
      dismissible={!busy}
      // Danger: focus Cancel first so Enter doesn't destroy by accident.
      initialFocus={variant === 'danger' ? cancelRef : undefined}
      footer={
        <>
          <button ref={cancelRef} type="button" className="btn btn-secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={clsx('btn', variant === 'danger' ? 'btn-danger' : 'btn-primary')}
            disabled={busy || confirmDisabled}
            aria-busy={busy}
            onClick={handleConfirm}
          >
            {busy && <Spinner size="sm" className="mr-2 text-current" label="Working" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-700">
          {error}
        </p>
      )}
      {!children && !error && <span className="sr-only">Confirm or cancel.</span>}
    </Dialog>
  );
}
