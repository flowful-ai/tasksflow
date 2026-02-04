import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';

interface KanbanCardProps {
  task: {
    id: string;
    title: string;
    priority: string | null;
    agent?: {
      id: string;
      name: string;
    } | null;
  };
  onClick: () => void;
  isDragging?: boolean;
}

export function KanbanCard({ task, onClick, isDragging }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const priorityColors: Record<string, string> = {
    urgent: 'border-l-red-500',
    high: 'border-l-orange-500',
    medium: 'border-l-yellow-500',
    low: 'border-l-green-500',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={clsx(
        'p-3 bg-white rounded-lg border border-gray-200 cursor-pointer',
        'hover:border-primary-300 hover:shadow-sm transition-all',
        task.priority && `border-l-4 ${priorityColors[task.priority]}`,
        isDragging && 'opacity-50 shadow-lg'
      )}
    >
      <p className="text-sm text-gray-900 font-medium line-clamp-2">{task.title}</p>
      {task.agent && (
        <div className="mt-1.5 flex items-center gap-1">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
            {task.agent.name}
          </span>
        </div>
      )}
    </div>
  );
}
