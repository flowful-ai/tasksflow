import { useDroppable } from '@dnd-kit/core';
import clsx from 'clsx';
import { ColorDot } from '../ui/ColorDot';

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
    <section aria-label={`${name}, ${taskCount} tasks`} className="flex-shrink-0 w-64 sm:w-72">
      {/* Column header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center space-x-2">
          <ColorDot color={color} size="md" />
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
    </section>
  );
}
