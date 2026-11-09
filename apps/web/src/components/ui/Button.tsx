/**
 * Text button. Wraps the `.btn` component classes from index.css so every
 * button shares one look.
 *
 *   <Button onClick={save} loading={save.isPending}>Save changes</Button>
 *   <Button variant="secondary" leadingIcon={<LogOut />}>Leave</Button>
 *   <Button variant="danger" size="sm" trailingIcon={<Trash2 />}>Delete</Button>
 *   <Button asChild variant="secondary"><Link to="/projects">Back to projects</Link></Button>
 *
 * Icons are sized to 16px. `loading` disables the button and swaps the
 * leading icon for a spinner. `asChild` renders the single child element
 * (a router Link, an <a>) with the button styles (Radix Slot).
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import clsx from 'clsx';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Stretch to the container width. */
  block?: boolean;
  /** Render the child element (Link, <a>) instead of a <button>. */
  asChild?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'btn btn-primary',
  secondary: 'btn btn-secondary',
  ghost: 'btn btn-ghost',
  danger: 'btn btn-danger',
  link: 'inline-flex items-center text-sm font-medium text-primary-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60',
};

// `md` is the .btn default (px-4 py-2.5 text-sm).
const SIZES: Record<ButtonSize, string> = {
  md: '',
  sm: 'px-3 py-1.5',
  xs: 'px-2.5 py-1 text-xs',
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 [&>svg]:h-4 [&>svg]:w-4">
      {children}
    </span>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leadingIcon,
    trailingIcon,
    block = false,
    asChild = false,
    className,
    disabled,
    type,
    children,
    ...props
  },
  ref
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      {...(asChild ? {} : { type: type ?? 'button', disabled: disabled || loading })}
      aria-busy={loading || undefined}
      className={clsx(
        VARIANTS[variant],
        variant !== 'link' && SIZES[size],
        (loading || leadingIcon || trailingIcon) && 'gap-2',
        block && 'w-full justify-center',
        className
      )}
      {...props}
    >
      {loading ? (
        <Spinner size="sm" className="text-current" label="Working" />
      ) : (
        leadingIcon && <Icon>{leadingIcon}</Icon>
      )}
      <Slottable>{children}</Slottable>
      {trailingIcon && <Icon>{trailingIcon}</Icon>}
    </Comp>
  );
});
