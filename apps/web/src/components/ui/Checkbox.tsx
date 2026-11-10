/**
 * Native checkbox, optionally with a label and description beside it.
 *
 *   <Checkbox checked={on} onChange={(e) => setOn(e.target.checked)} label="Enabled" />
 *   <Checkbox label="Notify on new tasks" description="Posts to the channel." … />
 *   <Checkbox aria-label="Select task" … />   // bare box (lists, tables)
 */
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import { useFieldControl } from './field-context';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  description?: ReactNode;
  /** Classes for the wrapping <label> when `label` is set. */
  labelClassName?: string;
  /** Checked colour: `primary` (default) or `success` (completed items). */
  tone?: 'primary' | 'success';
}

// Colours live in TONES, not in `className`: Tailwind orders same-property
// utilities by its own rules, so a className override would not win.
const TONES = {
  primary: 'text-primary-600 focus:ring-primary-500',
  success: 'text-emerald-600 focus:ring-emerald-500',
} as const;

const BASE =
  'h-4 w-4 shrink-0 cursor-pointer rounded border-neutral-300 disabled:cursor-not-allowed';

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, labelClassName, tone = 'primary', className, ...rest },
  ref
) {
  const props = useFieldControl(rest);
  const generated = useId();
  const descriptionId = description ? `${props.id ?? generated}-desc` : undefined;
  const box = (
    <input
      ref={ref}
      type="checkbox"
      className={clsx(BASE, TONES[tone], (label || description) && 'mt-0.5', className)}
      {...props}
      aria-describedby={
        [props['aria-describedby'], descriptionId].filter(Boolean).join(' ') || undefined
      }
    />
  );
  if (!label && !description) return box;
  return (
    <label className={clsx('flex cursor-pointer items-start gap-2 text-sm', labelClassName)}>
      {box}
      <span className="min-w-0">
        {label && <span className="text-neutral-900">{label}</span>}
        {description && (
          <span id={descriptionId} className="block text-xs text-neutral-500">
            {description}
          </span>
        )}
      </span>
    </label>
  );
});
