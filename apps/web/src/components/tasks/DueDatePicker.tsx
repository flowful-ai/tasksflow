import { useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { Popover, PopoverContent, PopoverTrigger } from '../ui';

interface DueDatePickerProps {
  value: string | null;
  onChange: (date: string | null) => void;
  isLoading?: boolean;
}

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

/** Date input plus "Clear due date" (the body of the due date popover). */
export function DueDateOptions({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (date: string | null) => void;
}) {
  // Format value for input (YYYY-MM-DD)
  const inputValue = value ? value.split('T')[0] : '';
  return (
    <>
      <input
        type="date"
        value={inputValue}
        aria-label="Due date"
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full px-3 py-2 text-base md:text-sm border border-neutral-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        autoFocus
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="mt-2 w-full px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 rounded-lg transition-colors"
        >
          Clear due date
        </button>
      )}
    </>
  );
}

export function DueDatePicker({ value, onChange, isLoading }: DueDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <div
        id="due-date-label"
        className="flex items-center space-x-2 text-sm font-medium text-neutral-500 mb-2"
      >
        <Calendar className="w-4 h-4" aria-hidden />
        <span>Due date</span>
      </div>

      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isLoading}
            aria-labelledby="due-date-label due-date-value"
            className={clsx(
              'group w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg border transition-colors',
              'hover:border-neutral-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
              isLoading && 'opacity-50 cursor-not-allowed',
              value
                ? 'bg-white border-neutral-200 text-neutral-700'
                : 'bg-neutral-50 border-neutral-200 text-neutral-500'
            )}
          >
            <span id="due-date-value">{value ? formatDate(value) : 'No due date'}</span>
            <ChevronDown
              aria-hidden
              className="w-4 h-4 text-neutral-400 transition-transform group-data-[state=open]:rotate-180"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-3"
          aria-label="Pick a due date"
        >
          <DueDateOptions
            value={value}
            onChange={(date) => {
              onChange(date);
              setIsOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
