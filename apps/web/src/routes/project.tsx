import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MoreHorizontal, LayoutGrid, List } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api/client';
import { TaskDisplayContainer, type DisplayType, type TaskCardTask } from '../components/task-display';
import { TaskModal } from '../components/tasks/TaskModal';
import { TaskDetailSheet } from '../components/tasks/TaskDetailSheet';

// Task interface matching what the API returns
interface ProjectTask {
  id: string;
  title: string;
  priority: string | null;
  position: string;
  dueDate: string | null;
  sequenceNumber: number;
  stateId: string | null;
  state: {
    id: string;
    name: string;
    color: string | null;
    category: string;
  } | null;
  assignees: {
    id: string;
    name: string | null;
    email: string;
  }[];
  labels: {
    id: string;
    name: string;
    color: string | null;
  }[];
  agent: {
    id: string;
    name: string;
  } | null;
}

interface Project {
  id: string;
  name: string;
  identifier: string;
  taskStates: { id: string; name: string; color: string | null; category: string }[];
}

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [displayType, setDisplayType] = useState<DisplayType>('kanban');
  const menuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const response = await api.get<{ data: Project }>(`/api/projects/${projectId}`);
      return response.data;
    },
    enabled: !!projectId,
  });

  const { data: tasksData, isLoading: tasksLoading, refetch: refetchTasks } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: async () => {
      const response = await api.get<{ data: ProjectTask[] }>(`/api/tasks?projectId=${projectId}`);
      return response.data;
    },
    enabled: !!projectId,
  });

  // Transform tasks to TaskCardTask format for the display container
  const formattedTasks: TaskCardTask[] = useMemo(() => {
    if (!tasksData || !project) return [];
    return tasksData.map((task) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      dueDate: task.dueDate,
      state: task.state,
      assignees: task.assignees || [],
      labels: task.labels || [],
      project: { id: projectId!, identifier: project.identifier, name: project.name },
      agent: task.agent,
      sequenceNumber: task.sequenceNumber,
    }));
  }, [tasksData, projectId, project]);

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

  const taskStates = project.taskStates || [];

  const handleTaskMove = async (taskId: string, stateId: string, position: string) => {
    await api.post(`/api/tasks/${taskId}/move`, { stateId, position });
    refetchTasks();
    // Invalidate smart view queries since task state changes may affect filter results
    queryClient.invalidateQueries({ queryKey: ['smart-view-execute'] });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              {project.identifier}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            {project.name}
          </h1>
        </div>
        <div className="flex items-center space-x-2">
          {/* Display mode toggle */}
          <div className="flex items-center border border-gray-200 rounded-lg p-0.5">
            <button
              onClick={() => setDisplayType('kanban')}
              className={clsx(
                'p-1.5 rounded',
                displayType === 'kanban' ? 'bg-gray-100' : 'hover:bg-gray-50'
              )}
              title="Kanban view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setDisplayType('list')}
              className={clsx(
                'p-1.5 rounded',
                displayType === 'list' ? 'bg-gray-100' : 'hover:bg-gray-50'
              )}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
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

      {/* Task display */}
      <div className="flex-1 min-h-0">
        <TaskDisplayContainer
          tasks={formattedTasks}
          displayType={displayType}
          groupBy="state"
          onTaskClick={(taskId) => setSelectedTaskId(taskId)}
          onTaskMove={handleTaskMove}
          showProject={false}
          allowDragDrop={displayType === 'kanban'}
          availableStates={taskStates}
        />
      </div>

      {/* Create Task Modal */}
      {isCreateModalOpen && (
        <TaskModal
          projectId={projectId!}
          states={taskStates}
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
          states={taskStates}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={() => {
            refetchTasks();
          }}
        />
      )}
    </div>
  );
}
