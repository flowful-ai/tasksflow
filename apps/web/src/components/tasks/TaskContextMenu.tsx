import { useState, type ReactNode, type MouseEvent } from 'react';
import { Check, UserPlus } from 'lucide-react';
import type { TaskPriority } from '@flowtask/shared';
import { useAuthStore } from '../../stores/auth';
import { useTaskRelationsMutations, useUpdateTask } from '../../hooks/queries';
import {
  ColorDot,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui';

export interface ContextMenuState {
  id: string;
  name: string;
  color: string | null;
  category?: string;
}

interface TaskContextMenuProps {
  taskId: string;
  projectId?: string;
  currentPriority: string | null;
  currentStateId: string | null;
  assigneeIds: string[];
  states: ContextMenuState[];
  onUpdated?: () => void;
  children: ReactNode;
}

const priorityItems: Array<{ value: TaskPriority | null; label: string; dotColor: string }> = [
  { value: 'urgent', label: 'Urgent', dotColor: '#dc2626' },
  { value: 'high', label: 'High', dotColor: '#ea580c' },
  { value: 'medium', label: 'Medium', dotColor: '#ca8a04' },
  { value: 'low', label: 'Low', dotColor: '#16a34a' },
  { value: null, label: 'No priority', dotColor: '#9ca3af' },
];

/**
 * Right-click (or Shift+F10 / the context-menu key) menu on a task card: a
 * controlled DropdownMenu anchored at the pointer by a zero-size trigger.
 */
export function TaskContextMenu({
  taskId,
  projectId,
  currentPriority,
  currentStateId,
  assigneeIds,
  states,
  onUpdated,
  children,
}: TaskContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const currentUserId = useAuthStore((state) => state.user?.id);
  const updateTask = useUpdateTask();
  const { addAssignee } = useTaskRelationsMutations(taskId, projectId);

  const isAssignedToMe = currentUserId ? assigneeIds.includes(currentUserId) : false;

  const handleContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Keyboard-triggered context menus report (0, 0): anchor to the card instead.
    if (e.clientX === 0 && e.clientY === 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      setPosition({ x: rect.left + 16, y: rect.top + 16 });
    } else {
      setPosition({ x: e.clientX, y: e.clientY });
    }
    setIsOpen(true);
  };

  const done = () => onUpdated?.();

  return (
    <div onContextMenu={handleContextMenu}>
      {children}
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none fixed h-0 w-0"
            style={{ left: position.x, top: position.y }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={2} aria-label="Task actions">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Priority</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {priorityItems.map((item) => {
                const isActive = item.value === (currentPriority || null);
                return (
                  <DropdownMenuItem
                    key={item.label}
                    icon={<ColorDot color={item.dotColor} size="md" />}
                    onSelect={() => {
                      if (!isActive) updateTask.mutate({ taskId, priority: item.value }, { onSuccess: done });
                    }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      {item.label}
                      {isActive && <Check className="h-3.5 w-3.5 text-primary-600" aria-label="Current" />}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Status</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto">
              {states.map((state) => {
                const isActive = state.id === currentStateId;
                return (
                  <DropdownMenuItem
                    key={state.id}
                    icon={<ColorDot color={state.color} size="md" />}
                    onSelect={() => {
                      if (!isActive) updateTask.mutate({ taskId, stateId: state.id }, { onSuccess: done });
                    }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      {state.name}
                      {isActive && <Check className="h-3.5 w-3.5 text-primary-600" aria-label="Current" />}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            icon={<UserPlus />}
            disabled={isAssignedToMe || !currentUserId}
            onSelect={() => {
              if (currentUserId && !isAssignedToMe) addAssignee.mutate(currentUserId, { onSuccess: done });
            }}
          >
            {isAssignedToMe ? 'Already assigned' : 'Assign to me'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
