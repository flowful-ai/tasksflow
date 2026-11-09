/**
 * Task detail (mockup section 4): header, title, description, sub-tasks,
 * relations and one activity timeline on the left; properties on the right
 * (stacked below on narrow screens). Rendered by the detail sheet, the
 * /task/:id page and the inbox preview.
 */
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { TaskPriority } from '@flowtask/shared';
import { useAuthStore } from '../../../stores/auth';
import { useUiStore } from '../../../stores/ui';
import { recordRecent } from '../../../lib/recent';
import {
  useAddComment,
  useDeleteTask,
  useProject,
  useTask,
  useTaskRelationsMutations,
  useUpdateTask,
  useWorkspace,
} from '../../../hooks/queries';
import { ErrorState, PageSpinner } from '../../ui';
import { Header } from './Header';
import { TaskDescription, TaskTitle } from './Description';
import { Properties } from './Properties';
import { Subtasks } from './Subtasks';
import { Relations } from './Relations';
import { Timeline } from './Timeline';
import { CommentComposer } from './CommentComposer';
import { taskKeyOf, type DetailState, type OpenTaskHandler, type TaskDetail } from './types';

export interface TaskDetailViewProps {
  taskId: string;
  mode: 'sheet' | 'page' | 'inline';
  onClose?: () => void;
  onOpenTask: OpenTaskHandler;
  /** Public share: no fetching, no editing. */
  readOnly?: boolean;
  initialTask?: TaskDetail;
  /** Override the project's states (callers that already have them). */
  states?: DetailState[];
  onUpdated?: () => void;
}

const byPosition = (a: DetailState, b: DetailState) => {
  const pa = a.position ?? '';
  const pb = b.position ?? '';
  return pa < pb ? -1 : pa > pb ? 1 : 0;
};

export function TaskDetailView({
  taskId,
  mode,
  onClose,
  onOpenTask,
  readOnly = false,
  initialTask,
  states: statesOverride,
  onUpdated,
}: TaskDetailViewProps) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const setActiveTaskId = useUiStore((s) => s.setActiveTaskId);
  const query = useTask(taskId, { enabled: !initialTask && !readOnly });
  const task: TaskDetail | undefined = initialTask ?? query.data;
  const projectId = task?.project.id;

  const { data: project } = useProject(readOnly ? null : projectId);
  const workspaceId = project?.workspaceId;
  const { data: workspace } = useWorkspace(readOnly ? null : workspaceId);
  const members = workspace?.members ?? [];
  const role = members.find((m) => m.userId === currentUserId)?.role;
  const canModerate = role === 'owner' || role === 'admin';

  const states = useMemo<DetailState[]>(() => {
    if (statesOverride && statesOverride.length > 0) return statesOverride;
    return [...(project?.taskStates ?? [])].sort(byPosition);
  }, [statesOverride, project?.taskStates]);

  const updateTask = useUpdateTask();
  const sets = useTaskRelationsMutations(taskId, projectId);
  const addComment = useAddComment(taskId);
  const deleteTask = useDeleteTask();

  // Announce the visible task (⌘K "Copy task link") and remember it for the palette's recents.
  useEffect(() => {
    if (readOnly) return;
    setActiveTaskId(taskId);
    return () => {
      if (useUiStore.getState().activeTaskId === taskId) setActiveTaskId(null);
    };
  }, [taskId, readOnly, setActiveTaskId]);
  const title = task?.title;
  const key = task ? taskKeyOf(task) : null;
  useEffect(() => {
    if (!readOnly && workspaceId && key && title) recordRecent(workspaceId, { kind: 'task', id: taskId, key, title });
  }, [readOnly, workspaceId, key, title, taskId]);

  if (!task) {
    if (query.isLoading) return <PageSpinner label="Loading task" />;
    return (
      <div className="p-6">
        <ErrorState
          error={query.error}
          resource="task"
          onRetry={() => void query.refetch()}
          notFoundAction={
            onClose ? (
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Close
              </button>
            ) : (
              <Link to="/projects" className="btn btn-secondary">
                Back to projects
              </Link>
            )
          }
        />
      </div>
    );
  }

  const update = (input: {
    title?: string;
    description?: string;
    stateId?: string;
    priority?: TaskPriority | null;
    dueDate?: string | null;
    parentId?: string | null;
  }) =>
    updateTask.mutateAsync({ taskId, ...input }).then(
      () => onUpdated?.(),
      () => undefined // toasted by the MutationCache handler
    );
  const withUpdated = { onSuccess: () => onUpdated?.() };
  const assigneeIds = new Set(task.assignees.map((a) => a.id));
  const labelIds = new Set(task.labels.map((l) => l.id));

  const handleDelete = canModerate
    ? () => {
        deleteTask.mutate({ taskId, projectId: task.project.id, label: taskKeyOf(task) }, withUpdated);
        onClose?.();
      }
    : undefined;

  const twoColumns = mode === 'inline' ? 'xl:grid-cols-[minmax(0,1fr)_248px]' : 'md:grid-cols-[minmax(0,1fr)_264px]';

  return (
    <div className={clsx('flex min-h-0 flex-col', mode !== 'page' && 'h-full')}>
      <Header task={task} mode={mode} onClose={onClose} onDelete={handleDelete} readOnly={readOnly} />

      <div className={clsx('min-h-0 flex-1', mode !== 'page' && 'overflow-y-auto')}>
        <div className={clsx('grid grid-cols-1', twoColumns)}>
          <div className="min-w-0 space-y-5 px-4 py-5 sm:px-6">
            <TaskTitle title={task.title} readOnly={readOnly} onSave={(t) => update({ title: t })} />
            <TaskDescription
              description={task.description}
              readOnly={readOnly}
              onSave={(description) => update({ description })}
            />

            {!readOnly && (
              <>
                <Subtasks
                  taskId={taskId}
                  projectId={task.project.id}
                  subtasks={task.subtasks ?? []}
                  states={states}
                  onOpenTask={onOpenTask}
                />
                <Relations taskId={taskId} workspaceId={workspaceId} onOpenTask={onOpenTask} />

                <section aria-labelledby={`activity-${taskId}`} className="space-y-3">
                  <h3 id={`activity-${taskId}`} className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    Activity
                  </h3>
                  <Timeline taskId={taskId} currentUserId={currentUserId} canModerate={canModerate} members={members} />
                  <CommentComposer
                    members={members}
                    isSubmitting={addComment.isPending}
                    onSubmit={(content) => addComment.mutateAsync(content).then(() => undefined)}
                  />
                </section>
              </>
            )}
          </div>

          <aside
            aria-label="Task properties"
            className={clsx(
              'border-t border-neutral-200 bg-neutral-50/60 px-4 py-5 sm:px-5',
              mode === 'inline' ? 'xl:border-l xl:border-t-0' : 'md:border-l md:border-t-0'
            )}
          >
            <Properties
              task={task}
              states={states}
              projectLabels={project?.labels ?? []}
              members={members}
              workspaceId={workspaceId}
              readOnly={readOnly}
              onUpdate={(input) => void update(input)}
              onToggleAssignee={(userId) =>
                assigneeIds.has(userId) ? sets.removeAssignee.mutate(userId, withUpdated) : sets.addAssignee.mutate(userId, withUpdated)
              }
              onToggleLabel={(labelId) =>
                labelIds.has(labelId) ? sets.removeLabel.mutate(labelId, withUpdated) : sets.addLabel.mutate(labelId, withUpdated)
              }
              onOpenTask={onOpenTask}
              onUpdated={onUpdated}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
