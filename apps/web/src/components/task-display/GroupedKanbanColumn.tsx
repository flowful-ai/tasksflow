import { useDroppable } from '@dnd-kit/core';
import clsx from 'clsx';

interface GroupedKanbanColumnProps {
  id: string;
  name: string;
  color: string | null;
  taskCount: number;
  children: React.ReactNode;
}

export function GroupedKanbanColumn({
  id,
  name,
  color,
  taskCount,
  children,
}: GroupedKanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id,
  });

  return (
    <div className="flex-shrink-0 w-72">
      {/* Column header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center space-x-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: color || '#6b7280' }}
          />
          <h3 className="font-medium text-gray-900">{name}</h3>
          <span className="text-sm text-gray-500">{taskCount}</span>
        </div>
      </div>

      {/* Column content */}
      <div
        ref={setNodeRef}
        className={clsx(
          'min-h-[200px] p-2 rounded-lg transition-colors',
          isOver ? 'bg-primary-50' : 'bg-gray-100'
        )}
      >
        <div className="space-y-2">
          {children}
        </div>
      </div>
    </div>
  );
}
