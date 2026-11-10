import clsx from 'clsx';

const COLUMN_CARDS = [4, 2, 3, 1];

/** Placeholder columns while the first page loads (instead of a full-page spinner). */
export function BoardSkeleton({ variant = 'kanban' }: { variant?: 'kanban' | 'list' }) {
  if (variant === 'list') {
    return (
      <div role="status" aria-label="Loading tasks" className="flex flex-col gap-3">
        {COLUMN_CARDS.map((rows, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="h-4 w-32 animate-pulse rounded-sm bg-neutral-200" />
            <div className="overflow-hidden rounded-xl border border-neutral-200">
              {Array.from({ length: rows }, (_, j) => (
                <div
                  key={j}
                  className="flex items-center gap-3 border-b border-neutral-100 px-3 py-3 last:border-b-0"
                >
                  <div className="h-3 w-12 animate-pulse rounded-sm bg-neutral-200" />
                  <div className="h-3 flex-1 animate-pulse rounded-sm bg-neutral-100" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div role="status" aria-label="Loading tasks" className="flex gap-3 overflow-hidden pb-4">
      {COLUMN_CARDS.map((cards, i) => (
        <div key={i} className="flex w-[264px] shrink-0 flex-col gap-2">
          <div className="flex items-center gap-2 px-1 py-1">
            <div className="h-2 w-2 rounded-full bg-neutral-300" />
            <div className="h-3.5 w-24 animate-pulse rounded-sm bg-neutral-200" />
          </div>
          <div className="flex min-h-[200px] flex-col gap-2 rounded-xl bg-neutral-100/70 p-1.5">
            {Array.from({ length: cards }, (_, j) => (
              <div
                key={j}
                className="flex flex-col gap-2 rounded-[10px] border border-neutral-200 bg-white px-3 py-2.5"
              >
                <div className="h-2.5 w-12 animate-pulse rounded-sm bg-neutral-200" />
                <div
                  className={clsx(
                    'h-3 animate-pulse rounded-sm bg-neutral-100',
                    j % 2 ? 'w-3/4' : 'w-full'
                  )}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
