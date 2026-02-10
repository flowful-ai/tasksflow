import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MoreHorizontal, LayoutGrid, List } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api/client';
import {
  BulkTaskToolbar,
  type BulkAssignMode,
  type BulkAssigneeOption,
  TaskDisplayContainer,
  type DisplayType,
  type TaskCardTask,
} from '../components/task-display';
import { TaskModal } from '../components/tasks/TaskModal';
import { TaskDetailSheet } from '../components/tasks/TaskDetailSheet';

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
    avatarUrl?: string | null;
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
  workspaceId: string;
  name: string;
  identifier: string;
  taskStates: { id: string; name: string; color: string | null; category: string }[];
}

interface WorkspaceDetail {
  members: {
    userId: string;
    user: {
      id: string;
      name: string | null;
      email: string;
      avatarUrl: string | null;
    };
  }[];
}

type NoticeType = 'success' | 'warning' | 'error';

interface BulkNotice {
  type: NoticeType;
  message: string;
}

function resolveDoneStateId(states: Project['taskStates']): string | null {
  const doneStates = states.filter((state) => state.category === 'done');
  const exactDone = doneStates.find((state) => state.name.trim().toLowerCase() === 'done');
  if (exactDone) return exactDone.id;

  const nonCancelDone = doneStates.find((state) => !/cancel/i.test(state.name));
  if (nonCancelDone) return nonCancelDone.id;

  return doneStates[0]?.id ?? null;
}

function resolveCancelStateId(states: Project['taskStates']): string | null {
  const cancelState = states.find((state) => state.category === 'done' && /cancel/i.test(state.name));
  return cancelState?.id ?? null;
}

function summarizeBulkAction(action: string, success: number, skipped: number, failed: number): BulkNotice {
  const suffix = [
    `${success} succeeded`,
    skipped > 0 ? `${skipped} skipped` : null,
    failed > 0 ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(', ');

  if (failed > 0) {
    return { type: 'error', message: `${action}: ${suffix}.` };
  }
  if (skipped > 0) {
    return { type: 'warning', message: `${action}: ${suffix}.` };
  }
  return { type: 'success', message: `${action}: ${suffix}.` };
}

async function settleOperations(operations: Array<Promise<unknown>>): Promise<{ success: number; failed: number }> {
  if (operations.length === 0) {
    return { success: 0, failed: 0 };
  }

  const settled = await Promise.allSettled(operations);
  const failed = settled.filter((result) => result.status === 'rejected').length;
  return { success: settled.length - failed, failed };
}

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [displayType, setDisplayType] = useState<DisplayType>('kanban');
  const [isBulkActionPending, setIsBulkActionPending] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<BulkNotice | null>(null);
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

  const { data: workspaceDetail } = useQuery({
    queryKey: ['workspace', project?.workspaceId],
    queryFn: async () => {
      const response = await api.get<{ data: WorkspaceDetail }>(`/api/workspaces/${project!.workspaceId}`);
      return response.data;
    },
    enabled: !!project?.workspaceId,
  });

  const { data: tasksData, isLoading: tasksLoading, refetch: refetchTasks } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: async () => {
      const response = await api.get<{ data: ProjectTask[] }>(`/api/tasks?projectId=${projectId}`);
      return response.data;
    },
    enabled: !!projectId,
  });

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

  const selectedTasks = useMemo(() => {
    if (selectedTaskIds.size === 0) return [];
    return formattedTasks.filter((task) => selectedTaskIds.has(task.id));
  }, [formattedTasks, selectedTaskIds]);

  const assigneeOptions = useMemo<BulkAssigneeOption[]>(() => {
    return (workspaceDetail?.members || []).map((member) => ({
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      avatarUrl: member.user.avatarUrl,
    }));
  }, [workspaceDetail?.members]);

  useEffect(() => {
    function handleClickOutside(event: globalThis.MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isMenuOpen]);

  useEffect(() => {
    if (!bulkNotice) return;

    const timeoutId = window.setTimeout(() => setBulkNotice(null), 4500);
    return () => window.clearTimeout(timeoutId);
  }, [bulkNotice]);

  useEffect(() => {
    setSelectedTaskIds((previous) => {
      if (previous.size === 0) {
        return previous;
      }

      const availableTaskIds = new Set(formattedTasks.map((task) => task.id));
      const next = new Set([...previous].filter((taskId) => availableTaskIds.has(taskId)));

      if (next.size === previous.size) {
        return previous;
      }

      return next;
    });
  }, [formattedTasks]);

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

  const refreshTaskData = async () => {
    await refetchTasks();
    await queryClient.invalidateQueries({ queryKey: ['smart-view-execute'] });
  };

  const handleTaskMove = async (taskId: string, stateId: string, position: string) => {
    await api.post(`/api/tasks/${taskId}/move`, { stateId, position });
    await refreshTaskData();
  };

  const handleTaskClick = (taskId: string, event: MouseEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey) {
      setSelectedTaskIds((previous) => {
        const next = new Set(previous);
        if (next.has(taskId)) {
          next.delete(taskId);
        } else {
          next.add(taskId);
        }
        return next;
      });
      return;
    }

    setSelectedTaskIds(new Set());
    setSelectedTaskId(taskId);
  };

  const runBulkAction = async (
    actionLabel: string,
    operationBuilder: () => { operations: Array<Promise<unknown>>; skipped: number }
  ) => {
    if (selectedTasks.length === 0) {
      return;
    }

    setIsBulkActionPending(true);

    try {
      const { operations, skipped } = operationBuilder();
      const { success, failed } = await settleOperations(operations);

      await refreshTaskData();

      if (failed === 0 && skipped === 0) {
        setSelectedTaskIds(new Set());
      }

      setBulkNotice(summarizeBulkAction(actionLabel, success, skipped, failed));
    } finally {
      setIsBulkActionPending(false);
    }
  };

  const handleBulkAssign = async (userId: string, mode: BulkAssignMode) => {
    await runBulkAction('Assign', () => {
      let skipped = 0;

      const operations = selectedTasks.flatMap((task) => {
        const alreadyAssigned = task.assignees.some((assignee) => assignee.id === userId);

        if (mode === 'add') {
          if (alreadyAssigned) {
            skipped += 1;
            return [];
          }

          return [api.post(`/api/tasks/${task.id}/assignees`, { userId })];
        }

        const assigneesToRemove = task.assignees.filter((assignee) => assignee.id !== userId);

        if (assigneesToRemove.length === 0 && alreadyAssigned) {
          skipped += 1;
          return [];
        }

        return [
          (async () => {
            await Promise.all(
              assigneesToRemove.map((assignee) => api.delete(`/api/tasks/${task.id}/assignees/${assignee.id}`))
            );

            if (!alreadyAssigned) {
              await api.post(`/api/tasks/${task.id}/assignees`, { userId });
            }
          })(),
        ];
      });

      return { operations, skipped };
    });
  };

  const handleBulkMoveToDone = async () => {
    const targetStateId = resolveDoneStateId(taskStates);

    if (!targetStateId) {
      setBulkNotice({ type: 'warning', message: 'Move to Done: 0 succeeded, all selected tasks were skipped.' });
      return;
    }

    await runBulkAction('Move to Done', () => ({
      operations: selectedTasks.map((task) => api.patch(`/api/tasks/${task.id}`, { stateId: targetStateId })),
      skipped: 0,
    }));
  };

  const handleBulkCancel = async () => {
    const targetStateId = resolveCancelStateId(taskStates);

    if (!targetStateId) {
      setBulkNotice(summarizeBulkAction('Cancel', 0, selectedTasks.length, 0));
      return;
    }

    await runBulkAction('Cancel', () => ({
      operations: selectedTasks.map((task) => api.patch(`/api/tasks/${task.id}`, { stateId: targetStateId })),
      skipped: 0,
    }));
  };

  const handleBulkDelete = async () => {
    await runBulkAction('Delete', () => ({
      operations: selectedTasks.map((task) => api.delete(`/api/tasks/${task.id}`)),
      skipped: 0,
    }));
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              {project.identifier}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{project.name}</h1>
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex items-center border border-gray-200 rounded-lg p-0.5">
            <button
              onClick={() => setDisplayType('kanban')}
              className={clsx('p-1.5 rounded', displayType === 'kanban' ? 'bg-gray-100' : 'hover:bg-gray-50')}
              title="Kanban view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setDisplayType('list')}
              className={clsx('p-1.5 rounded', displayType === 'list' ? 'bg-gray-100' : 'hover:bg-gray-50')}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          <button onClick={() => setIsCreateModalOpen(true)} className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            Add Task
          </button>
          <div ref={menuRef} className="relative">
            <button className="btn btn-ghost p-2" onClick={() => setIsMenuOpen((previous) => !previous)}>
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

      <BulkTaskToolbar
        selectedCount={selectedTaskIds.size}
        members={assigneeOptions}
        isLoading={isBulkActionPending}
        onClearSelection={() => setSelectedTaskIds(new Set())}
        onAssign={handleBulkAssign}
        onMoveToDone={handleBulkMoveToDone}
        onCancel={handleBulkCancel}
        onDelete={handleBulkDelete}
      />

      <div className="flex-1 min-h-0">
        <TaskDisplayContainer
          tasks={formattedTasks}
          displayType={displayType}
          groupBy="state"
          onTaskClick={handleTaskClick}
          onTaskMove={handleTaskMove}
          showProject={false}
          allowDragDrop={displayType === 'kanban'}
          availableStates={taskStates}
          selectedTaskIds={selectedTaskIds}
        />
      </div>

      {bulkNotice && (
        <div
          className={clsx(
            'fixed bottom-4 right-4 z-50 rounded-lg px-4 py-2 text-sm font-medium shadow-lg',
            bulkNotice.type === 'success' && 'bg-green-600 text-white',
            bulkNotice.type === 'warning' && 'bg-amber-500 text-white',
            bulkNotice.type === 'error' && 'bg-red-600 text-white'
          )}
        >
          {bulkNotice.message}
        </div>
      )}

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
