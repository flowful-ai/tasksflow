import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Pencil, LayoutGrid, List, Table, Calendar, Filter } from 'lucide-react';
import { TaskDisplayContainer, taskKeyOf, type DisplayType } from '../components/task-display';
import type { MoveTaskInput, TaskStateDto } from '../api/types';
import { ShareButton, ShareDialog, ActiveShareBanner } from '../components/smart-views/ShareDialog';
import { LiveIndicator } from '../components/realtime/ConnectionStatus';
import { BoardSkeleton } from '../components/board/BoardSkeleton';
import { BulkActionBar, type BulkBarLabel } from '../components/board/BulkActionBar';
import { useBoardKeyboard } from '../components/board/useBoardKeyboard';
import { EmptyState, ErrorState, Spinner, toast } from '../components/ui';
import {
  useDeleteTask,
  useMoveTask,
  useProjectsById,
  usePublicShareMutations,
  useSmartViewTasks,
  useWorkspace,
} from '../hooks/queries';
import { useUiStore } from '../stores/ui';

const displayTypeIcons: Record<DisplayType, React.ComponentType<{ className?: string }>> = {
  kanban: LayoutGrid,
  list: List,
  table: Table,
  calendar: Calendar,
};

export function SmartViewPage() {
  const { viewId } = useParams<{ viewId: string }>();
  const openTaskSheet = useUiStore((s) => s.openTaskSheet);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  const viewQuery = useSmartViewTasks(viewId);
  const { view, tasks: matchedTasks, total } = viewQuery;
  // A sub-task whose parent also matched is reachable from the parent card, so it
  // is not shown twice. Sub-tasks matched on their own stay visible: a saved
  // filter such as "assigned to me" must not hide them.
  const tasks = useMemo(() => {
    const matched = new Set(matchedTasks.map((task) => task.id));
    return matchedTasks.filter((task) => !task.parentId || !matched.has(task.parentId));
  }, [matchedTasks]);
  const { data: workspaceDetail } = useWorkspace(view?.workspaceId);
  const shares = usePublicShareMutations(viewId ?? '');
  const moveAsync = useMoveTask().mutateAsync;

  const projectIds = useMemo(() => [...new Set(tasks.map((task) => task.project.id))], [tasks]);
  const { projects } = useProjectsById(projectIds);

  const allProjectStates = useMemo<TaskStateDto[]>(
    () => projects.flatMap((project) => project.taskStates),
    [projects]
  );
  const labelsByProject = useMemo(
    () => new Map<string, BulkBarLabel[]>(projects.map((project) => [project.id, project.labels])),
    [projects]
  );
  const members = useMemo(() => workspaceDetail?.members ?? [], [workspaceDetail?.members]);

  const visibleIds = useMemo(() => tasks.map((t) => t.id), [tasks]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const deleteMutate = useDeleteTask().mutate;
  const deleteOne = useCallback(
    (taskId: string) => {
      const task = taskById.get(taskId);
      if (task) deleteMutate({ taskId, projectId: task.projectId, label: taskKeyOf(task) });
    },
    [taskById, deleteMutate]
  );

  const keyboard = useBoardKeyboard({
    containerRef: boardRef,
    visibleIds,
    onOpen: openTaskSheet,
    onDeleteOne: deleteOne,
    enabled: !showShareDialog,
  });
  const selectedTasks = useMemo(
    () => (keyboard.selectedIds.size === 0 ? [] : tasks.filter((task) => keyboard.selectedIds.has(task.id))),
    [tasks, keyboard.selectedIds]
  );

  const onTaskMove = useCallback(
    (move: MoveTaskInput) => moveAsync(move).then(
      () => undefined,
      () => undefined
    ),
    [moveAsync]
  );
  const onInvalidDrop = useCallback((message: string) => toast.warning(message), []);

  const activePublicShares = useMemo(() => view?.publicShares?.filter((share) => share.isActive) ?? [], [view?.publicShares]);
  const primaryActiveShare = activePublicShares[0];

  if (viewQuery.isLoading) {
    return <BoardSkeleton />;
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


      <div ref={boardRef} className="min-h-0 min-w-0 flex-1 pb-20">
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
            onTaskClick={keyboard.onTaskClick}
            onTaskMove={isStateGrouping ? onTaskMove : undefined}
            onInvalidDrop={onInvalidDrop}
            showProject={true}
            allowDragDrop={displayType === 'kanban' && isStateGrouping}
            availableStates={allProjectStates}
            mergeStatesByCategory={true}
            selectedTaskIds={keyboard.selectedIds}
          />
        )}
      </div>

      <BulkActionBar
        tasks={selectedTasks}
        picker={keyboard.picker}
        onPickerChange={keyboard.setPicker}
        onClear={keyboard.clearSelection}
        states={allProjectStates}
        members={members}
        labelsByProject={labelsByProject}
        onDeleteOne={deleteOne}
      />


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
