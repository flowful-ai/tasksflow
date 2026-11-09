import clsx from 'clsx';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** Announced to screen readers (default "Loading"). */
  label?: string;
  className?: string;
}

const SIZES = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-[3px]',
} as const;

/** Inline loading indicator with role="status". */
export function Spinner({ size = 'md', label = 'Loading', className }: SpinnerProps) {
  return (
    <span role="status" className={clsx('inline-flex items-center text-primary-600', className)}>
      <span
        aria-hidden
        className={clsx(
          'animate-spin rounded-full border-current border-r-transparent',
          SIZES[size]
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Centered spinner filling its container (route and section loading). */
export function PageSpinner({
  label = 'Loading',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={clsx('flex h-64 items-center justify-center', className)}>
      <Spinner size="lg" label={label} />
    </div>
  );
}
