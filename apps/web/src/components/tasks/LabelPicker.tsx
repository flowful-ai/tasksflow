import { useState, useRef, useEffect } from 'react';
import { Tag, X, Check, Plus } from 'lucide-react';
import clsx from 'clsx';

interface Label {
  id: string;
  name: string;
  color: string | null;
}

interface LabelPickerProps {
  currentLabels: Label[];
  projectLabels: Label[];
  onAdd: (labelId: string) => void;
  onRemove: (labelId: string) => void;
  isLoading?: boolean;
}

export function LabelPicker({
  currentLabels,
  projectLabels,
  onAdd,
  onRemove,
  isLoading,
}: LabelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const labelIds = new Set(currentLabels.map((l) => l.id));

  const filteredLabels = projectLabels.filter((label) => {
    const name = label.name.toLowerCase();
    const query = search.toLowerCase();
    return name.includes(query);
  });

  const handleToggle = (labelId: string) => {
    if (labelIds.has(labelId)) {
      onRemove(labelId);
    } else {
      onAdd(labelId);
    }
  };

  const handleRemove = (e: React.MouseEvent, labelId: string) => {
    e.stopPropagation();
    onRemove(labelId);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center space-x-2 text-sm font-medium text-gray-500 mb-2">
        <Tag className="w-4 h-4" />
        <span>Labels</span>
      </div>

      {/* Current labels display */}
      {currentLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {currentLabels.map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-medium rounded-full group"
              style={{
                backgroundColor: label.color ? `${label.color}20` : '#e5e7eb',
                color: label.color || '#374151',
              }}
            >
              <span>{label.name}</span>
              <button
                type="button"
                onClick={(e) => handleRemove(e, label.id)}
                disabled={isLoading}
                className="p-0.5 hover:bg-black/10 rounded-full transition-colors opacity-0 group-hover:opacity-100"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add button / dropdown trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className={clsx(
          'flex items-center space-x-1.5 px-3 py-1.5 text-sm rounded-lg border border-dashed transition-colors',
          'border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-600',
          isLoading && 'opacity-50 cursor-not-allowed'
        )}
      >
        <Plus className="w-3.5 h-3.5" />
        <span>Add label</span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-10 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-gray-100">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search labels..."
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {/* Labels list */}
          <div className="max-h-48 overflow-y-auto">
            {filteredLabels.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-400 text-center">
                {search ? 'No labels found' : 'No labels available'}
              </div>
            ) : (
              filteredLabels.map((label) => {
                const isSelected = labelIds.has(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => handleToggle(label.id)}
                    disabled={isLoading}
                    className={clsx(
                      'w-full flex items-center space-x-3 px-3 py-2 text-left hover:bg-gray-50 transition-colors',
                      isSelected && 'bg-primary-50'
                    )}
                  >
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: label.color || '#9ca3af' }}
                    />
                    <span className="flex-1 text-sm text-gray-700 truncate">{label.name}</span>
                    {isSelected && <Check className="w-4 h-4 text-primary-600 flex-shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
