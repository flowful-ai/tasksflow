import { useState } from 'react';
import { Tag, X, Check, Plus } from 'lucide-react';
import clsx from 'clsx';
import type { LabelDto } from '../../api/types';
import { ColorDot, IconButton, Popover, PopoverContent, PopoverTrigger } from '../ui';

type PickerLabel = Pick<LabelDto, 'id' | 'name' | 'color'>;

interface LabelPickerProps {
  currentLabels: PickerLabel[];
  projectLabels: PickerLabel[];
  onAdd: (labelId: string) => void;
  onRemove: (labelId: string) => void;
  isLoading?: boolean;
}

export interface LabelOptionsProps {
  currentLabels: PickerLabel[];
  projectLabels: PickerLabel[];
  onToggle: (labelId: string) => void;
  isLoading?: boolean;
}

/** Searchable, multi-select label list (the body of the label popover). */
export function LabelOptions({
  currentLabels,
  projectLabels,
  onToggle,
  isLoading,
}: LabelOptionsProps) {
  const [search, setSearch] = useState('');
  const labelIds = new Set(currentLabels.map((l) => l.id));
  const query = search.toLowerCase();
  const filteredLabels = projectLabels.filter((label) => label.name.toLowerCase().includes(query));

  return (
    <>
      <div className="p-2 border-b border-gray-100">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search labels..."
          aria-label="Search labels"
          autoFocus
          className="w-full px-3 py-1.5 text-base md:text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>
      <div
        className="max-h-48 overflow-y-auto"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Labels"
      >
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
                role="option"
                aria-selected={isSelected}
                onClick={() => onToggle(label.id)}
                disabled={isLoading}
                className={clsx(
                  'w-full flex items-center space-x-3 px-3 py-2 text-left hover:bg-gray-50 transition-colors',
                  isSelected && 'bg-primary-50'
                )}
              >
                <ColorDot color={label.color} size="md" />
                <span className="flex-1 text-sm text-gray-700 truncate">{label.name}</span>
                {isSelected && (
                  <Check className="w-4 h-4 text-primary-600 flex-shrink-0" aria-hidden />
                )}
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

/** Label chips plus an "Add label" popover with search (stays open to toggle several). */
export function LabelPicker({
  currentLabels,
  projectLabels,
  onAdd,
  onRemove,
  isLoading,
}: LabelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const labelIds = new Set(currentLabels.map((l) => l.id));

  const handleToggle = (labelId: string) => {
    if (labelIds.has(labelId)) onRemove(labelId);
    else onAdd(labelId);
  };

  return (
    <div>
      <div className="flex items-center space-x-2 text-sm font-medium text-gray-500 mb-2">
        <Tag className="w-4 h-4" aria-hidden />
        <span>Labels</span>
      </div>

      {currentLabels.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mb-2" aria-label="Current labels">
          {currentLabels.map((label) => (
            <li
              key={label.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white py-0.5 pl-2.5 pr-1 text-xs font-medium text-gray-700"
            >
              <ColorDot color={label.color} />
              <span>{label.name}</span>
              <IconButton
                label={`Remove label ${label.name}`}
                size="xs"
                icon={<X />}
                onClick={() => onRemove(label.id)}
                disabled={isLoading}
                className="rounded-full"
              />
            </li>
          ))}
        </ul>
      )}

      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isLoading}
            className={clsx(
              'flex items-center space-x-1.5 px-3 py-1.5 text-sm rounded-lg border border-dashed transition-colors',
              'border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-600',
              isLoading && 'opacity-50 cursor-not-allowed'
            )}
          >
            <Plus className="w-3.5 h-3.5" aria-hidden />
            <span>Add label</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0 overflow-hidden" aria-label="Pick labels">
          <LabelOptions
            currentLabels={currentLabels}
            projectLabels={projectLabels}
            onToggle={handleToggle}
            isLoading={isLoading}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
