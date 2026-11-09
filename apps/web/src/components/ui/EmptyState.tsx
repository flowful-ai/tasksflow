import clsx from 'clsx';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** A lucide icon element or an emoji. */
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  /** Usually one button, e.g. "Clear filter" or "Create task". */
  action?: ReactNode;
  /** Less vertical padding (inside columns, panels). */
  compact?: boolean;
  className?: string;
}

/**
 * Empty result (mockup section 6): an illustrated tile, a title, a hint and an
 * optional action.
 *
 *   <EmptyState icon={<FolderKanban />} title='No tasks match "Assignee: me"'
 *     body={<>Clear the filter or press <Kbd>C</Kbd> to create one.</>}
 *     action={<button className="btn btn-secondary" onClick={clear}>Clear filter</button>} />
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-2 text-center',
        compact ? 'py-6' : 'py-14',
        className
      )}
    >
      {icon && (
        <div
          aria-hidden
          className="mb-1 grid h-14 w-14 place-items-center rounded-[14px] border border-neutral-200 bg-neutral-50 text-2xl text-neutral-500 [&_svg]:h-6 [&_svg]:w-6"
        >
          {icon}
        </div>
      )}
      <p className="font-semibold text-neutral-900">{title}</p>
      {body && <div className="max-w-sm text-sm text-neutral-500">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
