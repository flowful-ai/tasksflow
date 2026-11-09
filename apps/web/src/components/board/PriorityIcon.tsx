import clsx from 'clsx';
import { PRIORITY_LABELS } from './filters';

const BAR_COUNT: Record<string, number> = { low: 1, medium: 2, high: 3 };

function isLabelledPriority(value: string): value is keyof typeof PRIORITY_LABELS {
  return value in PRIORITY_LABELS;
}

export function priorityLabel(priority: string | null | undefined): string | null {
  if (!priority || priority === 'none' || !isLabelledPriority(priority)) return null;
  return PRIORITY_LABELS[priority];
}

/**
 * Priority as a shape (mockup section 1): 1–3 filled bars, or a red "!" tile
 * for urgent. The label is sr-only text, so meaning never relies on colour.
 */
export function PriorityIcon({ priority, className }: { priority: string | null | undefined; className?: string }) {
  const label = priorityLabel(priority);
  if (!label) return null;
  const sr = <span className="sr-only">Priority: {label}</span>;
  if (priority === 'urgent') {
    return (
      <>
        <svg aria-hidden viewBox="0 0 16 16" className={clsx('h-3.5 w-3.5 shrink-0', className)}>
          <rect width="16" height="16" rx="4" className="fill-primary-500" />
          <text x="8" y="12" fontSize="11" fontWeight="800" textAnchor="middle" className="fill-white">
            !
          </text>
        </svg>
        {sr}
      </>
    );
  }
  const filled = BAR_COUNT[priority ?? ''] ?? 0;
  const bars = [
    { x: 1, y: 10, h: 5 },
    { x: 6.5, y: 6, h: 9 },
    { x: 12, y: 2, h: 13 },
  ];
  return (
    <>
      <svg aria-hidden viewBox="0 0 16 16" className={clsx('h-3.5 w-3.5 shrink-0 text-neutral-600', className)}>
        {bars.map((bar, i) => (
          <rect
            key={bar.x}
            x={bar.x}
            y={bar.y}
            width="3"
            height={bar.h}
            rx="1"
            className={i < filled ? 'fill-current' : 'fill-neutral-300'}
          />
        ))}
      </svg>
      {sr}
    </>
  );
}
