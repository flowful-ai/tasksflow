import clsx from 'clsx';

export type ControlSize = 'sm' | 'md';

const SIZES: Record<ControlSize, string> = {
  md: 'input',
  sm: 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500',
};

/** Classes shared by every text control; exported for the rare non-native control. */
export function controlClasses(size: ControlSize = 'md', invalid = false): string {
  return clsx(
    SIZES[size],
    invalid && '!border-red-300 focus:!border-red-500 focus:!ring-red-500/20'
  );
}
