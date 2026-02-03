import { useState, useRef, useEffect } from 'react';
import { Calendar, X, ChevronDown } from 'lucide-react';
import clsx from 'clsx';

interface DueDatePickerProps {
  value: string | null;
  onChange: (date: string | null) => void;
  isLoading?: boolean;
}

export function DueDatePicker({ value, onChange, isLoading }: DueDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value;
    onChange(newDate || null);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setIsOpen(false);
  };

  // Format value for input (YYYY-MM-DD)
  const inputValue = value ? value.split('T')[0] : '';

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center space-x-2 text-sm font-medium text-gray-500 mb-2">
        <Calendar className="w-4 h-4" />
        <span>Due date</span>
      </div>

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className={clsx(
          'w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg border transition-colors',
          'hover:border-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
          isLoading && 'opacity-50 cursor-not-allowed',
          value ? 'bg-white border-gray-200 text-gray-700' : 'bg-gray-50 border-gray-200 text-gray-400'
        )}
      >
        <span>{value ? formatDate(value) : 'No due date'}</span>
        <div className="flex items-center space-x-1">
          {value && (
            <span
              role="button"
              onClick={handleClear}
              className="p-0.5 hover:bg-gray-200 rounded transition-colors"
            >
              <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
            </span>
          )}
          <ChevronDown className={clsx('w-4 h-4 text-gray-400 transition-transform', isOpen && 'rotate-180')} />
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          <input
            type="date"
            value={inputValue}
            onChange={handleDateChange}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            autoFocus
          />
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="mt-2 w-full px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Clear due date
            </button>
          )}
        </div>
      )}
    </div>
  );
}
