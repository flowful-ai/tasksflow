/**
 * A row of mutually exclusive toggle buttons (aria-pressed).
 *
 *   <SegmentedControl label="View" value={mode} onChange={setMode}
 *     options={[{ value: 'kanban', label: 'Board' }, { value: 'list', label: 'List' }]} />
 *   <SegmentedControl variant="soft" block label="Invite type" …
 *     options={[{ value: 'email', label: 'Email', icon: <Mail /> }, …]} />
 *
 * 'outline' (default): compact bordered group (board top bar).
 * 'soft': bordered padded track whose active option is tinted primary (dialogs, forms).
 */
import type { ReactNode } from 'react';
import clsx from 'clsx';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  variant?: 'outline' | 'soft';
  /** Stretch options to fill the width. */
  block?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  variant = 'outline',
  block = false,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={clsx(
        'flex',
        variant === 'outline'
          ? 'overflow-hidden rounded-lg border border-neutral-200 text-[12.5px]'
          : 'rounded-lg border border-neutral-200 p-1 text-sm',
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={clsx(
              'inline-flex items-center justify-center gap-2 font-medium transition-colors [&_svg]:h-4 [&_svg]:w-4',
              block && 'flex-1',
              variant === 'outline'
                ? [
                    'px-2.5 py-1',
                    active
                      ? 'bg-neutral-100 font-semibold text-neutral-900'
                      : 'text-neutral-500 hover:text-neutral-800',
                  ]
                : [
                    'rounded-md px-3 py-2',
                    active
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-neutral-600 hover:bg-neutral-100',
                  ]
            )}
          >
            {option.icon && (
              <span aria-hidden className="contents">
                {option.icon}
              </span>
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
