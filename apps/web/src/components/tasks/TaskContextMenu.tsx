import { useState, useEffect, useRef, useCallback, type ReactNode, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, UserPlus } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';

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

const priorityItems = [
  { value: 'urgent', label: 'Urgent', dotColor: '#dc2626' },
  { value: 'high', label: 'High', dotColor: '#ea580c' },
  { value: 'medium', label: 'Medium', dotColor: '#ca8a04' },
  { value: 'low', label: 'Low', dotColor: '#16a34a' },
  { value: '', label: 'No priority', dotColor: '#9ca3af' },
];

type OpenSubmenu = 'priority' | 'status' | null;

export function TaskContextMenu({
  taskId,
  currentPriority,
  currentStateId,
  assigneeIds,
  states,
  onUpdated,
  children,
}: TaskContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [openSubmenu, setOpenSubmenu] = useState<OpenSubmenu>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((state) => state.user?.id);

  const isAssignedToMe = currentUserId ? assigneeIds.includes(currentUserId) : false;

  const invalidateTaskQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['task', taskId] });
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['smart-view-execute'] });
  }, [queryClient, taskId]);

  const updateMutation = useMutation({
    mutationFn: async (data: { priority?: string; stateId?: string }) => {
      return api.patch(`/api/tasks/${taskId}`, data);
    },
    onSuccess: () => {
      invalidateTaskQueries();
      onUpdated?.();
    },
  });

  const assignMutation = useMutation({
    mutationFn: async (userId: string) => {
      return api.post(`/api/tasks/${taskId}/assignees`, { userId });
    },
    onSuccess: () => {
      invalidateTaskQueries();
      onUpdated?.();
    },
  });

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const x = e.clientX;
    const y = e.clientY;

    setPosition({ x, y });
    setOpenSubmenu(null);
    setIsOpen(true);
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e: globalThis.MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        (!submenuRef.current || !submenuRef.current.contains(e.target as Node))
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let { x, y } = position;
    if (x + rect.width > vw) x = vw - rect.width - 8;
    if (y + rect.height > vh) y = vh - rect.height - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;

    if (x !== position.x || y !== position.y) {
      setPosition({ x, y });
    }
  }, [isOpen, position]);

  const handlePriorityChange = (value: string) => {
    if (value !== (currentPriority || '')) {
      updateMutation.mutate({ priority: value || undefined });
    }
    setIsOpen(false);
  };

  const handleStatusChange = (stateId: string) => {
    if (stateId !== currentStateId) {
      updateMutation.mutate({ stateId });
    }
    setIsOpen(false);
  };

  const handleAssignToMe = () => {
    if (currentUserId && !isAssignedToMe) {
      assignMutation.mutate(currentUserId);
    }
    setIsOpen(false);
  };

  // Compute submenu position based on parent item
  const getSubmenuPosition = () => {
    if (!menuRef.current) return { top: 0, left: 0 };
    const menuRect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;

    // Try to place submenu to the right
    const rightSpace = vw - menuRect.right;
    if (rightSpace >= 180) {
      return { left: menuRect.right - 4 };
    }
    // Place to the left
    return { left: menuRect.left - 176 };
  };

  const submenuPos = getSubmenuPosition();

  const menuContent = isOpen ? (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[180px] bg-white rounded-lg border border-gray-200 shadow-lg py-1"
      style={{ left: position.x, top: position.y }}
    >
      {/* Priority submenu trigger */}
      <button
        className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
        onMouseEnter={() => setOpenSubmenu('priority')}
        onClick={() => setOpenSubmenu(openSubmenu === 'priority' ? null : 'priority')}
      >
        <span>Priority</span>
        <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
      </button>

      {/* Status submenu trigger */}
      <button
        className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
        onMouseEnter={() => setOpenSubmenu('status')}
        onClick={() => setOpenSubmenu(openSubmenu === 'status' ? null : 'status')}
      >
        <span>Status</span>
        <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
      </button>

      {/* Separator */}
      <div className="my-1 border-t border-gray-100" />

      {/* Assign to me */}
      <button
        className={clsx(
          'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors',
          isAssignedToMe
            ? 'text-gray-400 cursor-default'
            : 'text-gray-700 hover:bg-gray-100'
        )}
        onClick={handleAssignToMe}
        disabled={isAssignedToMe || !currentUserId}
        onMouseEnter={() => setOpenSubmenu(null)}
      >
        <UserPlus className="w-3.5 h-3.5" />
        <span>{isAssignedToMe ? 'Already assigned' : 'Assign to me'}</span>
      </button>

      {/* Priority submenu */}
      {openSubmenu === 'priority' && (
        <div
          ref={submenuRef}
          className="fixed z-[101] min-w-[176px] bg-white rounded-lg border border-gray-200 shadow-lg py-1"
          style={{ left: submenuPos.left, top: menuRef.current ? menuRef.current.getBoundingClientRect().top : 0 }}
        >
          {priorityItems.map((item) => {
            const isActive = item.value === (currentPriority || '');
            return (
              <button
                key={item.value}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                onClick={() => handlePriorityChange(item.value)}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: item.dotColor }}
                />
                <span className="flex-1 text-left">{item.label}</span>
                {isActive && <Check className="w-3.5 h-3.5 text-primary-600" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Status submenu */}
      {openSubmenu === 'status' && (
        <div
          ref={submenuRef}
          className="fixed z-[101] min-w-[176px] bg-white rounded-lg border border-gray-200 shadow-lg py-1 max-h-[300px] overflow-y-auto"
          style={{
            left: submenuPos.left,
            top: menuRef.current
              ? menuRef.current.getBoundingClientRect().top + 32
              : 0,
          }}
        >
          {states.map((state) => {
            const isActive = state.id === currentStateId;
            return (
              <button
                key={state.id}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                onClick={() => handleStatusChange(state.id)}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: state.color || '#9ca3af' }}
                />
                <span className="flex-1 text-left">{state.name}</span>
                {isActive && <Check className="w-3.5 h-3.5 text-primary-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div onContextMenu={handleContextMenu}>
      {children}
      {menuContent && createPortal(menuContent, document.body)}
    </div>
  );
}
