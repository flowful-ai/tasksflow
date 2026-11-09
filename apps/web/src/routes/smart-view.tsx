import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Pencil, LayoutGrid, List, Table, Calendar, Filter } from 'lucide-react';
import {
  BulkTaskToolbar,
  type BulkAssigneeOption,
  type BulkLabelOption,
  TaskDisplayContainer,
  type DisplayType,
  type TaskOpenEvent,
} from '../components/task-display';
import type { TaskStateDto } from '../api/types';
import { TaskDetailSheet } from '../components/tasks/TaskDetailSheet';
import { ShareButton, ShareDialog, ActiveShareBanner } from '../components/smart-views/ShareDialog';
import { LiveIndicator } from '../components/realtime/ConnectionStatus';
import { EmptyState, ErrorState, PageSpinner, Spinner, toast } from '../components/ui';
import {
  useMoveTask,
  useProjectsById,
  usePublicShareMutations,
  useSmartViewTasks,
  useWorkspace,
} from '../hooks/queries';
import { useBulkTaskActions } from '../hooks/useBulkTaskActions';

const displayTypeIcons: Record<DisplayType, React.ComponentType<{ className?: string }>> = {
  kanban: LayoutGrid,
  list: List,
  table: Table,
  calendar: Calendar,
};

/** Label option ids in a multi-project view are "projectId:labelId". */
function parseCompositeLabelIds(ids: string[]): Map<string, string[]> {
  const byProject = new Map<string, string[]>();
  for (const compositeId of ids) {
    const [projectId, labelId] = compositeId.split(':');
    if (!projectId || !labelId) continue;
    byProject.set(projectId, [...(byProject.get(projectId) ?? []), labelId]);
  }
  return byProject;
}

export function SmartViewPage() {
  const { viewId } = useParams<{ viewId: string }>();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [showShareDialog, setShowShareDialog] = useState(false);

  const viewQuery = useSmartViewTasks(viewId);
  const { view, tasks, total } = viewQuery;
  const { data: workspaceDetail } = useWorkspace(view?.workspaceId);
  const shares = usePublicShareMutations(viewId ?? '');
  const moveTask = useMoveTask();

  const projectIds = useMemo(() => [...new Set(tasks.map((task) => task.project.id))], [tasks]);
  const { projects } = useProjectsById(projectIds);

  const allProjectStates = useMemo<TaskStateDto[]>(
    () => projects.flatMap((project) => project.taskStates),
    [projects]
  );

  const selectedTasks = useMemo(
    () => (selectedTaskIds.size === 0 ? [] : tasks.filter((task) => selectedTaskIds.has(task.id))),
    [tasks, selectedTaskIds]
  );
  const bulk = useBulkTaskActions(selectedTasks, allProjectStates, () => setSelectedTaskIds(new Set()));

  const selectedProjectIds = useMemo(() => [...new Set(selectedTasks.map((task) => task.project.id))], [selectedTasks]);

  const assigneeOptions = useMemo<BulkAssigneeOption[]>(
    () =>
      (workspaceDetail?.members || []).map((member) => ({
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
        avatarUrl: member.user.avatarUrl,
      })),
    [workspaceDetail?.members]
  );

  const labelOptions = useMemo<BulkLabelOption[]>(() => {
    const isMultiProject = selectedProjectIds.length > 1;
    const visible = new Set(selectedProjectIds);
    return projects
      .filter((project) => visible.has(project.id))
      .flatMap((project) =>
        project.labels.map((label) => ({
          id: `${project.id}:${label.id}`,
          name: isMultiProject ? `${project.identifier} · ${label.name}` : label.name,
          color: label.color,
        }))
      );
  }, [projects, selectedProjectIds]);

  const selectedTask = useMemo(
    () => (selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) ?? null : null),
    [selectedTaskId, tasks]
  );
  const selectedTaskStates = useMemo(
    () => projects.find((project) => project.id === selectedTask?.project.id)?.taskStates ?? [],
    [projects, selectedTask?.project.id]
  );

  const activePublicShares = useMemo(() => view?.publicShares?.filter((share) => share.isActive) ?? [], [view?.publicShares]);
  const primaryActiveShare = activePublicShares[0];

  // Drop selections for tasks that left the view.
  useEffect(() => {
    setSelectedTaskIds((previous) => {
      if (previous.size === 0) return previous;
      const available = new Set(tasks.map((task) => task.id));
      const next = new Set([...previous].filter((taskId) => available.has(taskId)));
      return next.size === previous.size ? previous : next;
    });
  }, [tasks]);

  const handleTaskClick = (taskId: string, event: TaskOpenEvent) => {
    if (event.ctrlKey || event.metaKey) {
      setSelectedTaskIds((previous) => {
        const next = new Set(previous);
        if (next.has(taskId)) next.delete(taskId);
        else next.add(taskId);
        return next;
      });
      return;
    }
    setSelectedTaskIds(new Set());
    setSelectedTaskId(taskId);
  };

  if (viewQuery.isLoading) {
    return <PageSpinner label="Loading view" />;
  }

  if (!view) {
    return (
      <ErrorState
        error={viewQuery.error}
        resource="view"
        onRetry={() => void viewQuery.refetch()}
        notFoundAction={
          <Link to="/views" className="btn btn-secondary">
            Back to views
          </Link>
        }
      />
    );
  }

  const displayType = view.displayType || 'list';
  const groupBy = view.groupBy || 'state';
  const secondaryGroupBy = view.secondaryGroupBy || undefined;
  const DisplayIcon = displayTypeIcons[displayType] || List;
  const isStateGrouping = groupBy === 'state' || secondaryGroupBy === 'state';

  return (
    <div className="h-full flex flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{view.name}</h1>
            <DisplayIcon className="w-5 h-5 text-gray-400" aria-hidden />
            <span className="sr-only">{displayType} view</span>
          </div>
          {view.description && <p className="text-gray-600 mt-1">{view.description}</p>}
          <div className="mt-2 flex items-center gap-2">
            <LiveIndicator suffix={`${total} task${total !== 1 ? 's' : ''}`} />
            {(!viewQuery.isComplete || (viewQuery.isFetching && !viewQuery.isFetchingNextPage)) && (
              <Spinner size="sm" label="Updating tasks" />
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ShareButton hasActiveShares={activePublicShares.length > 0} onClick={() => setShowShareDialog(true)} />
          <Link to={`/settings/views/${viewId}/edit`} className="btn btn-secondary inline-flex items-center">
            <Pencil className="w-4 h-4 mr-2" aria-hidden />
            Edit
          </Link>
        </div>
      </header>

      {primaryActiveShare && (
        <ActiveShareBanner
          shareUrl={`${window.location.origin}/share/${primaryActiveShare.token}`}
          hasPassword={primaryActiveShare.hasPassword}
          expiresAt={primaryActiveShare.expiresAt}
          accessCount={primaryActiveShare.accessCount}
          maxAccessCount={primaryActiveShare.maxAccessCount}
          onManage={() => setShowShareDialog(true)}
        />
      )}

      <BulkTaskToolbar
        selectedCount={selectedTaskIds.size}
        members={assigneeOptions}
        labels={labelOptions}
        isLoading={bulk.isPending}
        onClearSelection={() => setSelectedTaskIds(new Set())}
        onAssign={bulk.assign}
        onSetLabels={(ids) => bulk.setLabelsByProject(parseCompositeLabelIds(ids))}
        onMoveToDone={bulk.moveToDone}
        onCancel={bulk.cancel}
        onDelete={bulk.remove}
      />

      <div className="flex-1 min-h-0">
        {tasks.length === 0 && viewQuery.isComplete ? (
          <EmptyState
            icon={<Filter />}
            title="No tasks match this view"
            body="Edit the view's filters to widen it."
            action={
              <Link to={`/settings/views/${viewId}/edit`} className="btn btn-secondary">
                Edit filters
              </Link>
            }
          />
        ) : (
          <TaskDisplayContainer
            tasks={tasks}
            displayType={displayType}
            groupBy={groupBy}
            secondaryGroupBy={secondaryGroupBy}
            onTaskClick={handleTaskClick}
            onTaskMove={isStateGrouping ? (move) => moveTask.mutateAsync(move).then(() => undefined, () => undefined) : undefined}
            onInvalidDrop={(message) => toast.warning(message)}
            showProject={true}
            allowDragDrop={displayType === 'kanban' && isStateGrouping}
            availableStates={allProjectStates}
            mergeStatesByCategory={true}
            selectedTaskIds={selectedTaskIds}
          />
        )}
      </div>

      {selectedTaskId && selectedTask && (
        <TaskDetailSheet
          taskId={selectedTaskId}
          projectId={selectedTask.project.id}
          states={selectedTaskStates}
          onClose={() => setSelectedTaskId(null)}
        />
      )}

      {showShareDialog && (
        <ShareDialog
          viewName={view.name}
          publicShares={view.publicShares || []}
          isCreating={shares.create.isPending}
          isDisabling={shares.disable.isPending}
          isDeleting={shares.remove.isPending}
          onClose={() => setShowShareDialog(false)}
          onCreate={(shareData) => shares.create.mutate(shareData, { onSuccess: () => setShowShareDialog(false) })}
          onDisable={(shareId) => shares.disable.mutate(shareId)}
          onDelete={(shareId) => shares.remove.mutate(shareId)}
        />
      )}
    </div>
  );
}
