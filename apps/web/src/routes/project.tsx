import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MoreHorizontal } from 'lucide-react';
import { api } from '../api/client';
import { KanbanBoard } from '../components/kanban/KanbanBoard';
import { TaskModal } from '../components/tasks/TaskModal';
import { TaskDetailSheet } from '../components/tasks/TaskDetailSheet';

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const response = await api.get<{ data: unknown }>(`/api/projects/${projectId}`);
      return response.data;
    },
    enabled: !!projectId,
  });

  const { data: tasksData, isLoading: tasksLoading, refetch: refetchTasks } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: async () => {
      const response = await api.get<{ data: unknown[] }>(`/api/tasks?projectId=${projectId}`);
      return response.data;
    },
    enabled: !!projectId,
  });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isMenuOpen]);

  if (projectLoading || tasksLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Project not found</h2>
      </div>
    );
  }

  const tasks = tasksData || [];
  const taskStates = (project as { taskStates?: unknown[] }).taskStates || [];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              {(project as { identifier: string }).identifier}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            {(project as { name: string }).name}
          </h1>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="btn btn-primary"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Task
          </button>
          <div ref={menuRef} className="relative">
            <button
              className="btn btn-ghost p-2"
              onClick={() => setIsMenuOpen((prev) => !prev)}
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
            {isMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                <Link
                  to={`/project/${projectId}/settings`}
                  className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Project Settings
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-hidden">
        <KanbanBoard
          states={taskStates as { id: string; name: string; category: string; color: string | null }[]}
          tasks={tasks as { id: string; stateId: string | null; title: string; priority: string | null; position: string }[]}
          onTaskClick={(taskId) => setSelectedTaskId(taskId)}
          onTaskMove={async (taskId, stateId, position) => {
            await api.post(`/api/tasks/${taskId}/move`, { stateId, position });
            refetchTasks();
            // Invalidate smart view queries since task state changes may affect filter results
            queryClient.invalidateQueries({ queryKey: ['smart-view-execute'] });
          }}
        />
      </div>

      {/* Create Task Modal */}
      {isCreateModalOpen && (
        <TaskModal
          projectId={projectId!}
          states={taskStates as { id: string; name: string }[]}
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={() => {
            setIsCreateModalOpen(false);
            refetchTasks();
          }}
        />
      )}

      {/* Task Detail Sheet */}
      {selectedTaskId && (
        <TaskDetailSheet
          taskId={selectedTaskId}
          projectId={projectId!}
          states={taskStates as { id: string; name: string; color: string | null; category: string }[]}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={() => {
            refetchTasks();
          }}
        />
      )}
    </div>
  );
}
