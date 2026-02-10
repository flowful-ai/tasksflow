import { useEffect, useState, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, LayoutGrid, List, Table, Calendar } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api/client';
import {
  BulkTaskToolbar,
  type BulkAssignMode,
  type BulkAssigneeOption,
  TaskDisplayContainer,
  type DisplayType,
  type GroupBy,
  type TaskCardTask,
} from '../components/task-display';
import { TaskDetailSheet } from '../components/tasks/TaskDetailSheet';
import {
  ShareButton,
  ShareDialog,
  ActiveShareBanner,
  type PublicShare,
  type CreateShareData,
} from '../components/smart-views/ShareDialog';

interface SmartViewTask {
  id: string;
  title: string;
  description: string | null;
  priority: string | null;
  position: string;
  dueDate: string | null;
  startDate: string | null;
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
  project: {
    id: string;
    identifier: string;
    name: string;
  };
  agent: {
    id: string;
    name: string;
  } | null;
  externalLinks: {
    id: string;
    externalType: 'github_issue' | 'github_pr';
    externalId: string;
    externalUrl: string;
  }[];
  createdAt: string;
  updatedAt: string | null;
}

interface SmartViewData {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  displayType: DisplayType;
  groupBy: GroupBy;
  secondaryGroupBy?: GroupBy | null;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  visibleFields: string[] | null;
  publicShares?: PublicShare[];
}

interface TaskState {
  id: string;
  name: string;
  color: string | null;
  category: string;
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

const displayTypeIcons: Record<DisplayType, React.ComponentType<{ className?: string }>> = {
  kanban: LayoutGrid,
  list: List,
  table: Table,
  calendar: Calendar,
};

interface AvailableState extends TaskState {
  projectId: string;
}

function resolveDoneStateId(states: AvailableState[]): string | null {
  const doneStates = states.filter((state) => state.category === 'done');
  const exactDone = doneStates.find((state) => state.name.trim().toLowerCase() === 'done');
  if (exactDone) return exactDone.id;

  const nonCancelDone = doneStates.find((state) => !/cancel/i.test(state.name));
  if (nonCancelDone) return nonCancelDone.id;

  return doneStates[0]?.id ?? null;
}

function resolveCancelStateId(states: AvailableState[]): string | null {
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

export function SmartViewPage() {
  const { viewId } = useParams<{ viewId: string }>();
  const queryClient = useQueryClient();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bulkNotice, setBulkNotice] = useState<BulkNotice | null>(null);
  const [isBulkActionPending, setIsBulkActionPending] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['smart-view-execute', viewId],
    queryFn: async () => {
      const response = await api.get<{
        data: {
          view: SmartViewData;
          tasks: SmartViewTask[];
          meta: { total: number; page: number; limit: number };
        };
      }>(`/api/smart-views/${viewId}/execute`);
      return response.data;
    },
    enabled: !!viewId,
  });

  const { data: workspaceDetail } = useQuery({
    queryKey: ['workspace', data?.view.workspaceId],
    queryFn: async () => {
      const response = await api.get<{ data: WorkspaceDetail }>(`/api/workspaces/${data!.view.workspaceId}`);
      return response.data;
    },
    enabled: !!data?.view.workspaceId,
  });

  const createShareMutation = useMutation({
    mutationFn: async (shareData: CreateShareData) => {
      const response = await api.post<{
        success: boolean;
        data: PublicShare & { shareUrl: string };
      }>(`/api/smart-views/${viewId}/public`, shareData);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smart-view-execute', viewId] });
      setShowShareDialog(false);
    },
  });

  const disableShareMutation = useMutation({
    mutationFn: async (shareId: string) => {
      await api.post(`/api/smart-views/${viewId}/public/${shareId}/disable`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smart-view-execute', viewId] });
    },
  });

  const deleteShareMutation = useMutation({
    mutationFn: async (shareId: string) => {
      await api.delete(`/api/smart-views/${viewId}/public/${shareId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smart-view-execute', viewId] });
    },
  });

  const projectIds = useMemo(() => {
    if (!data?.tasks) return [];
    return [...new Set(data.tasks.map((task) => task.project.id))];
  }, [data?.tasks]);

  const { data: allProjectStates = [] } = useQuery({
    queryKey: ['projects-states', projectIds],
    queryFn: async (): Promise<AvailableState[]> => {
      const results = await Promise.all(
        projectIds.map((pid) =>
          api
            .get<{ data: TaskState[] }>(`/api/projects/${pid}/states`)
            .then((response) => response.data.map((state) => ({ ...state, projectId: pid })))
        )
      );
      return results.flat();
    },
    enabled: projectIds.length > 0,
  });

  const moveMutation = useMutation({
    mutationFn: async ({ taskId, stateId, position }: { taskId: string; stateId: string; position: string }) => {
      await api.post(`/api/tasks/${taskId}/move`, { stateId, position });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smart-view-execute', viewId] });
    },
  });

  const tasks: TaskCardTask[] = useMemo(() => {
    if (!data?.tasks) return [];
    return data.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      dueDate: task.dueDate,
      position: task.position,
      state: task.state,
      assignees: task.assignees,
      labels: task.labels,
      project: task.project,
      agent: task.agent,
      sequenceNumber: task.sequenceNumber,
    }));
  }, [data?.tasks]);

  const selectedTasks = useMemo(() => {
    if (selectedTaskIds.size === 0) return [];
    return tasks.filter((task) => selectedTaskIds.has(task.id));
  }, [tasks, selectedTaskIds]);

  const statesByProject = useMemo(() => {
    const grouped = new Map<string, AvailableState[]>();
    allProjectStates.forEach((state) => {
      const existing = grouped.get(state.projectId) || [];
      existing.push(state);
      grouped.set(state.projectId, existing);
    });
    return grouped;
  }, [allProjectStates]);

  const assigneeOptions = useMemo<BulkAssigneeOption[]>(() => {
    return (workspaceDetail?.members || []).map((member) => ({
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      avatarUrl: member.user.avatarUrl,
    }));
  }, [workspaceDetail?.members]);

  const selectedTask = useMemo(() => {
    if (!selectedTaskId || !data?.tasks) return null;
    return data.tasks.find((task) => task.id === selectedTaskId) || null;
  }, [selectedTaskId, data?.tasks]);

  const activePublicShares = useMemo(() => {
    return data?.view.publicShares?.filter((share) => share.isActive) || [];
  }, [data?.view.publicShares]);

  const primaryActiveShare = activePublicShares[0];

  const { data: projectStates = [] } = useQuery({
    queryKey: ['project-states', selectedTask?.project.id],
    queryFn: async () => {
      if (!selectedTask?.project.id) return [];
      const response = await api.get<{ data: TaskState[] }>(`/api/projects/${selectedTask.project.id}/states`);
      return response.data;
    },
    enabled: !!selectedTask?.project.id,
  });

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

      const availableTaskIds = new Set(tasks.map((task) => task.id));
      const next = new Set([...previous].filter((taskId) => availableTaskIds.has(taskId)));

      if (next.size === previous.size) {
        return previous;
      }

      return next;
    });
  }, [tasks]);

  const refreshSmartView = async () => {
    await queryClient.invalidateQueries({ queryKey: ['smart-view-execute', viewId] });
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

      await refreshSmartView();

      if (failed === 0 && skipped === 0) {
        setSelectedTaskIds(new Set());
      }

      setBulkNotice(summarizeBulkAction(actionLabel, success, skipped, failed));
    } finally {
      setIsBulkActionPending(false);
    }
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

  const handleTaskUpdated = () => {
    queryClient.invalidateQueries({ queryKey: ['smart-view-execute', viewId] });
  };

  const handleTaskMove = async (taskId: string, stateId: string, position: string) => {
    await moveMutation.mutateAsync({ taskId, stateId, position });
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
    await runBulkAction('Move to Done', () => {
      let skipped = 0;

      const operations = selectedTasks.flatMap((task) => {
        const projectStates = statesByProject.get(task.project.id) || [];
        const targetStateId = resolveDoneStateId(projectStates);

        if (!targetStateId) {
          skipped += 1;
          return [];
        }

        return [api.patch(`/api/tasks/${task.id}`, { stateId: targetStateId })];
      });

      return { operations, skipped };
    });
  };

  const handleBulkCancel = async () => {
    await runBulkAction('Cancel', () => {
      let skipped = 0;

      const operations = selectedTasks.flatMap((task) => {
        const projectStates = statesByProject.get(task.project.id) || [];
        const targetStateId = resolveCancelStateId(projectStates);

        if (!targetStateId) {
          skipped += 1;
          return [];
        }

        return [api.patch(`/api/tasks/${task.id}`, { stateId: targetStateId })];
      });

      return { operations, skipped };
    });
  };

  const handleBulkDelete = async () => {
    await runBulkAction('Delete', () => ({
      operations: selectedTasks.map((task) => api.delete(`/api/tasks/${task.id}`)),
      skipped: 0,
    }));
  };

  const handleInvalidDrop = (message: string) => {
    setErrorMessage(message);
    setTimeout(() => setErrorMessage(null), 3000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">View not found</h2>
      </div>
    );
  }

  const view = data.view;
  const displayType = view.displayType || 'list';
  const groupBy = view.groupBy || 'state';
  const secondaryGroupBy = view.secondaryGroupBy || undefined;
  const DisplayIcon = displayTypeIcons[displayType] || List;
  const isStateGrouping = groupBy === 'state' || secondaryGroupBy === 'state';

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{view.name}</h1>
            <DisplayIcon className="w-5 h-5 text-gray-400" />
          </div>
          {view.description && <p className="text-gray-600 mt-1">{view.description}</p>}
          <p className="text-sm text-gray-500 mt-2">
            {data.meta.total} task{data.meta.total !== 1 ? 's' : ''} found
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ShareButton hasActiveShares={activePublicShares.length > 0} onClick={() => setShowShareDialog(true)} />
          <Link to={`/settings/views/${viewId}/edit`} className="btn btn-secondary inline-flex items-center">
            <Pencil className="w-4 h-4 mr-2" />
            Edit
          </Link>
        </div>
      </div>

      {primaryActiveShare && (
        <ActiveShareBanner
          shareUrl={`${window.location.origin}/share/${primaryActiveShare.token}`}
          hasPassword={!!primaryActiveShare.passwordHash}
          expiresAt={primaryActiveShare.expiresAt}
          accessCount={primaryActiveShare.accessCount}
          maxAccessCount={primaryActiveShare.maxAccessCount}
          onManage={() => setShowShareDialog(true)}
        />
      )}

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
          tasks={tasks}
          displayType={displayType}
          groupBy={groupBy}
          secondaryGroupBy={secondaryGroupBy}
          onTaskClick={handleTaskClick}
          onTaskMove={isStateGrouping ? handleTaskMove : undefined}
          onInvalidDrop={handleInvalidDrop}
          showProject={true}
          allowDragDrop={displayType === 'kanban' && isStateGrouping}
          availableStates={allProjectStates}
          mergeStatesByCategory={true}
          selectedTaskIds={selectedTaskIds}
        />
      </div>

      {errorMessage && (
        <div className="fixed bottom-4 right-4 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-in fade-in slide-in-from-bottom-2">
          {errorMessage}
        </div>
      )}

      {bulkNotice && (
        <div
          className={clsx(
            'fixed bottom-4 left-4 z-50 rounded-lg px-4 py-2 text-sm font-medium shadow-lg',
            bulkNotice.type === 'success' && 'bg-green-600 text-white',
            bulkNotice.type === 'warning' && 'bg-amber-500 text-white',
            bulkNotice.type === 'error' && 'bg-red-600 text-white'
          )}
        >
          {bulkNotice.message}
        </div>
      )}

      {selectedTaskId && selectedTask && (
        <TaskDetailSheet
          taskId={selectedTaskId}
          projectId={selectedTask.project.id}
          states={projectStates}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={handleTaskUpdated}
        />
      )}

      {showShareDialog && (
        <ShareDialog
          viewName={view.name}
          publicShares={view.publicShares || []}
          isCreating={createShareMutation.isPending}
          isDisabling={disableShareMutation.isPending}
          isDeleting={deleteShareMutation.isPending}
          onClose={() => setShowShareDialog(false)}
          onCreate={(shareData) => createShareMutation.mutate(shareData)}
          onDisable={(shareId) => disableShareMutation.mutate(shareId)}
          onDelete={(shareId) => deleteShareMutation.mutate(shareId)}
        />
      )}
    </div>
  );
}
