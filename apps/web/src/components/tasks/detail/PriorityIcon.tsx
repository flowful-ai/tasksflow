import clsx from 'clsx';

const LEVELS: Record<string, number> = { low: 1, medium: 2, high: 3 };

/** Priority as a shape (mockup section 1): "!" tile for urgent, 1–3 bars otherwise. */
export function PriorityIcon({ priority, className }: { priority: string | null | undefined; className?: string }) {
  if (priority === 'urgent') {
    return (
      <svg aria-hidden viewBox="0 0 16 16" className={clsx('h-4 w-4 shrink-0', className)}>
        <rect width="16" height="16" rx="4" className="fill-primary-500" />
        <text x="8" y="12" fontSize="11" fontWeight="800" fill="#fff" textAnchor="middle">
          !
        </text>
      </svg>
    );
  }
  const level = LEVELS[priority ?? ''] ?? 0;
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={clsx('h-4 w-4 shrink-0 text-neutral-700', className)}>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1 + i * 5.5}
          y={10 - i * 4}
          width="3"
          height={5 + i * 4}
          rx="1"
          className={i < level ? 'fill-current' : 'fill-neutral-300'}
        />
      ))}
    </svg>
  );
}
