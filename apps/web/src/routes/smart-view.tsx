import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, LayoutGrid, List, Table, Calendar } from 'lucide-react';
import { api } from '../api/client';
import { TaskDisplayContainer, type DisplayType, type GroupBy, type TaskCardTask } from '../components/task-display';
import { TaskDetailSheet } from '../components/tasks/TaskDetailSheet';
import {
  ShareButton,
  ShareDialog,
  ActiveShareBanner,
  type PublicShare,
  type CreateShareData,
} from '../components/smart-views/ShareDialog';

// Full task interface matching TaskWithRelations from the API
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

const displayTypeIcons: Record<DisplayType, React.ComponentType<{ className?: string }>> = {
  kanban: LayoutGrid,
  list: List,
  table: Table,
  calendar: Calendar,
};

// Extended TaskState with projectId for cross-project state resolution
interface AvailableState extends TaskState {
  projectId: string;
}

export function SmartViewPage() {
  const { viewId } = useParams<{ viewId: string }>();
  const queryClient = useQueryClient();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  // Create share mutation
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

  // Disable share mutation
  const disableShareMutation = useMutation({
    mutationFn: async (shareId: string) => {
      await api.post(`/api/smart-views/${viewId}/public/${shareId}/disable`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smart-view-execute', viewId] });
    },
  });

  // Delete share mutation
  const deleteShareMutation = useMutation({
    mutationFn: async (shareId: string) => {
      await api.delete(`/api/smart-views/${viewId}/public/${shareId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smart-view-execute', viewId] });
    },
  });

  // Extract unique project IDs from tasks
  const projectIds = useMemo(() => {
    if (!data?.tasks) return [];
    return [...new Set(data.tasks.map(t => t.project.id))];
  }, [data?.tasks]);

  // Fetch states for all projects appearing in the view
  const { data: allProjectStates } = useQuery({
    queryKey: ['projects-states', projectIds],
    queryFn: async (): Promise<AvailableState[]> => {
      const results = await Promise.all(
        projectIds.map(pid =>
          api.get<{ data: TaskState[] }>(`/api/projects/${pid}/states`)
            .then(r => r.data.map(s => ({ ...s, projectId: pid })))
        )
      );
      return results.flat();
    },
    enabled: projectIds.length > 0,
  });

  // Move task mutation
  const moveMutation = useMutation({
    mutationFn: async ({ taskId, stateId, position }: { taskId: string; stateId: string; position: string }) => {
      await api.post(`/api/tasks/${taskId}/move`, { stateId, position });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smart-view-execute', viewId] });
    },
  });

  // Transform tasks to TaskCardTask format
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

  // Get the selected task for the detail sheet
  const selectedTask = useMemo(() => {
    if (!selectedTaskId || !data?.tasks) return null;
    return data.tasks.find((t) => t.id === selectedTaskId) || null;
  }, [selectedTaskId, data?.tasks]);

  // Compute active public shares
  const activePublicShares = useMemo(() => {
    return data?.view.publicShares?.filter((s) => s.isActive) || [];
  }, [data?.view.publicShares]);

  // Get the first active share for the banner
  const primaryActiveShare = activePublicShares[0];

  // Fetch states for the selected task's project (for TaskDetailSheet)
  const { data: projectStates = [] } = useQuery({
    queryKey: ['project-states', selectedTask?.project.id],
    queryFn: async () => {
      if (!selectedTask?.project.id) return [];
      const response = await api.get<{ data: TaskState[] }>(
        `/api/projects/${selectedTask.project.id}/states`
      );
      return response.data;
    },
    enabled: !!selectedTask?.project.id,
  });

  const handleTaskClick = (taskId: string) => {
    setSelectedTaskId(taskId);
  };

  const handleTaskUpdated = () => {
    // Invalidate the smart view query to refresh data
    queryClient.invalidateQueries({ queryKey: ['smart-view-execute', viewId] });
  };

  const handleTaskMove = async (taskId: string, stateId: string, position: string) => {
    await moveMutation.mutateAsync({ taskId, stateId, position });
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
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{view.name}</h1>
            <DisplayIcon className="w-5 h-5 text-gray-400" />
          </div>
          {view.description && (
            <p className="text-gray-600 mt-1">{view.description}</p>
          )}
          <p className="text-sm text-gray-500 mt-2">
            {data.meta.total} task{data.meta.total !== 1 ? 's' : ''} found
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ShareButton
            hasActiveShares={activePublicShares.length > 0}
            onClick={() => setShowShareDialog(true)}
          />
          <Link
            to={`/settings/views/${viewId}/edit`}
            className="btn btn-secondary inline-flex items-center"
          >
            <Pencil className="w-4 h-4 mr-2" />
            Edit
          </Link>
        </div>
      </div>

      {/* Active share banner */}
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

      {/* Task display */}
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
        />
      </div>

      {/* Error toast for invalid drops */}
      {errorMessage && (
        <div className="fixed bottom-4 right-4 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-in fade-in slide-in-from-bottom-2">
          {errorMessage}
        </div>
      )}

      {/* Task detail sheet */}
      {selectedTaskId && selectedTask && (
        <TaskDetailSheet
          taskId={selectedTaskId}
          projectId={selectedTask.project.id}
          states={projectStates}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={handleTaskUpdated}
        />
      )}

      {/* Share dialog */}
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
