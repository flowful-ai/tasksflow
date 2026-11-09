/**
 * Icon-only button. `label` is required: it becomes the aria-label and the
 * tooltip text, so an icon button can never be unlabeled.
 *
 *   <IconButton label="Close" icon={<X />} onClick={onClose} />
 *   <DropdownMenuTrigger asChild><IconButton label="More actions" icon={<MoreHorizontal />} /></DropdownMenuTrigger>
 *
 * Forwards its ref and extra props, so it works as a Radix `asChild` trigger.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import { Tooltip } from './Tooltip';

export type IconButtonVariant = 'ghost' | 'subtle' | 'solid' | 'danger' | 'sidebar';
export type IconButtonSize = 'xs' | 'sm' | 'md';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  /** Accessible name and tooltip text. */
  label: string;
  /** The icon (lucide). It is marked aria-hidden. */
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Shortcut shown in the tooltip, e.g. "C". */
  shortcut?: string;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  /** Set false to skip the tooltip (the aria-label stays). */
  showTooltip?: boolean;
}

const VARIANTS: Record<IconButtonVariant, string> = {
  ghost: 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800',
  subtle: 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200',
  solid: 'bg-neutral-900 text-white hover:bg-neutral-800',
  danger: 'text-neutral-500 hover:bg-primary-50 hover:text-primary-700',
  sidebar: 'text-sidebar-text-muted hover:bg-sidebar-hover hover:text-white',
};

const SIZES: Record<IconButtonSize, string> = {
  xs: 'p-1 rounded-md [&_svg]:h-3.5 [&_svg]:w-3.5',
  sm: 'p-1.5 rounded-lg [&_svg]:h-4 [&_svg]:w-4',
  md: 'p-2 rounded-lg [&_svg]:h-5 [&_svg]:w-5',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    variant = 'ghost',
    size = 'sm',
    shortcut,
    tooltipSide,
    showTooltip = true,
    className,
    type = 'button',
    ...props
  },
  ref
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    >
      <span aria-hidden className="contents">
        {icon}
      </span>
    </button>
  );

  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide} disabled={!showTooltip}>
      {button}
    </Tooltip>
  );
});
