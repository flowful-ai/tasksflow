import { useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Popover, PopoverContent, PopoverTrigger, Spinner } from '../../ui';
import { useSearch } from '../../../hooks/queries';
import { useDebouncedValue } from '../../../lib/useDebouncedValue';
import type { SearchTaskHit } from '../../../api/types';

interface TaskSearchPopoverProps {
  workspaceId: string | null | undefined;
  /** The trigger button (rendered with asChild). */
  trigger: ReactNode;
  label: string;
  /** Task ids that cannot be picked (the task itself, existing relations). */
  excludeIds?: ReadonlySet<string>;
  /** Restrict hits to one project (parent must be in the same project). */
  projectId?: string;
  onPick: (hit: SearchTaskHit) => void;
  footer?: ReactNode;
}

/** A popover with a task search (key or words) for picking a related task or a parent. */
export function TaskSearchPopover({
  workspaceId,
  trigger,
  label,
  excludeIds,
  projectId,
  onPick,
  footer,
}: TaskSearchPopoverProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 150);
  const search = useSearch(open ? workspaceId : null, debounced, 10);
  const hits = (search.data?.tasks ?? []).filter(
    (hit) => !excludeIds?.has(hit.id) && (!projectId || hit.projectId === projectId)
  );
  const hasQuery = debounced.trim().length > 0;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-80 p-0 overflow-hidden" aria-label={label}>
        <Command label={label} shouldFilter={false}>
          <div className="flex items-center gap-2 border-b border-neutral-100 p-2">
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search by key or title…"
              aria-label="Search tasks"
              autoFocus
              className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-base focus:border-primary-500 focus:ring-2 focus:ring-primary-500 md:text-sm"
            />
            {search.isFetching && <Spinner size="sm" label="Searching" />}
          </div>
          <Command.List className="max-h-64 overflow-y-auto p-1">
            {hasQuery && !search.isFetching && hits.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-neutral-400">
                No matching tasks
              </div>
            )}
            {!hasQuery && (
              <div className="px-3 py-4 text-center text-sm text-neutral-400">
                Type a key (TF-12) or words
              </div>
            )}
            {hits.map((hit) => (
              <Command.Item
                key={hit.id}
                value={hit.id}
                onSelect={() => {
                  onPick(hit);
                  setOpen(false);
                  setQuery('');
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-neutral-700 data-[selected=true]:bg-neutral-100"
              >
                <span className="shrink-0 font-mono text-xs text-neutral-500">{hit.key}</span>
                <span className="flex-1 truncate">{hit.title}</span>
              </Command.Item>
            ))}
          </Command.List>
          {footer && <div className="border-t border-neutral-100 p-1">{footer}</div>}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
