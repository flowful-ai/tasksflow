/**
 * Form field: label, control, hint and error with the id / aria wiring done.
 *
 *   <Field label="Name" hint="Shown to your team." error={error} required>
 *     <Input value={name} onChange={(e) => setName(e.target.value)} />
 *   </Field>
 *
 * The control inside (Input, Textarea, Select, Checkbox) picks up the id,
 * aria-describedby (hint + error), aria-invalid and required from context.
 * Pass `id` to choose the control id yourself.
 */
import { useId, useMemo, type ReactNode } from 'react';
import clsx from 'clsx';
import { FieldContext, type FieldControlProps } from './field-context';

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Id for the control (default: generated). */
  id?: string;
  /** Visually hide the label (it stays for screen readers). */
  hideLabel?: boolean;
  className?: string;
  /** Extra classes for the label (e.g. a smaller one in a dense form). */
  labelClassName?: string;
  children: ReactNode;
}

export const labelClasses = 'mb-1 block text-sm font-medium text-neutral-700';

export function Field({
  label,
  hint,
  error,
  required = false,
  id,
  hideLabel = false,
  className,
  labelClassName,
  children,
}: FieldProps) {
  const generated = useId();
  const controlId = id ?? `field-${generated}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;

  const control = useMemo<FieldControlProps>(
    () => ({
      id: controlId,
      'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
      'aria-invalid': error ? true : undefined,
      required: required || undefined,
    }),
    [controlId, hintId, errorId, error, required]
  );

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={controlId}
          className={clsx(labelClasses, hideLabel && 'sr-only', labelClassName)}
        >
          {label}
          {required && (
            <span aria-hidden className="ml-0.5 text-primary-600">
              *
            </span>
          )}
        </label>
      )}
      <FieldContext.Provider value={control}>{children}</FieldContext.Provider>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-neutral-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
