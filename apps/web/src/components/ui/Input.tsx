/**
 * Text controls. Each forwards its ref and picks up id / aria wiring from an
 * enclosing <Field>.
 *
 *   <Input value={q} onChange={…} placeholder="Search" />
 *   <Input size="sm" type="number" />            // dense rows (filter builder)
 *   <Textarea rows={4} value={…} onChange={…} />
 *   <Select value={role} onChange={(e) => setRole(e.target.value)}>
 *     <option value="member">Member</option>
 *   </Select>
 *
 * `md` is the `.input` class from index.css; `sm` is the compact variant;
 * `bare` drops the chrome for inline editors. Read-only inputs render greyed.
 *
 * Select is a native <select> with the browser arrow removed and a
 * ChevronDown inset 12px from the right edge; its `className` goes on the
 * wrapper (width, margins), `selectClassName` on the <select> itself.
 */
import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { controlClasses, type ControlSize } from './control-classes';
import { isInvalid, useFieldControl } from './field-context';

export type { ControlSize };

// Inputs and textareas only: a <select> always matches :read-only.
const READ_ONLY = 'read-only:bg-neutral-50 read-only:text-neutral-500';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: ControlSize;
  /** No border, padding or focus ring: inline editors that sit inside their own box. */
  bare?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', bare = false, className, type = 'text', ...rest },
  ref
) {
  const props = useFieldControl(rest);
  return (
    <input
      ref={ref}
      type={type}
      className={clsx(!bare && [controlClasses(size, isInvalid(props)), READ_ONLY], className)}
      {...props}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: ControlSize;
  /** No border, padding or focus ring: inline editors that sit inside their own box. */
  bare?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { size = 'md', bare = false, className, ...rest },
  ref
) {
  const props = useFieldControl(rest);
  return (
    <textarea
      ref={ref}
      className={clsx(!bare && [controlClasses(size, isInvalid(props)), READ_ONLY], className)}
      {...props}
    />
  );
});

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: ControlSize;
  /** Classes for the <select> element (className styles the wrapper). */
  selectClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', className, selectClassName, children, ...rest },
  ref
) {
  const props = useFieldControl(rest);
  return (
    <div className={clsx('relative', className)}>
      <select
        ref={ref}
        className={clsx(
          controlClasses(size, isInvalid(props)),
          'cursor-pointer appearance-none bg-white pr-9 disabled:cursor-not-allowed disabled:opacity-60',
          selectClassName
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
      />
    </div>
  );
});
