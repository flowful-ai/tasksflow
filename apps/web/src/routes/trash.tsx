/** Project trash: soft-deleted tasks with who/when, Restore and Restore all. */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import { tasksApi, trashApi } from '../api/tasks';
import { queryKeys } from '../api/queryKeys';
import type { TaskDto } from '../api/types';
import { useProject, useRestoreTask, useTrash } from '../hooks/queries';
import {
  ColorDot,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageSpinner,
  Spinner,
  toast,
} from '../components/ui';
import { formatDateTime, relativeTime } from '../lib/time';

const PAGE_SIZE = 50;

/** Who deleted the task: the newest "deleted" entry of its history. */
function useDeletedBy(taskId: string) {
  return useQuery({
    queryKey: [...queryKeys.tasks.history(taskId), 'deleted-by'],
    queryFn: async () => {
      const page = await tasksApi.history(taskId, { limit: 5 });
      const event = page.data.find((e) => e.type === 'deleted');
      return event?.actor?.name ?? event?.agent?.name ?? null;
    },
    staleTime: 5 * 60_000,
  });
}

function TrashRow({
  task,
  onRestore,
  restoring,
}: {
  task: TaskDto;
  onRestore: () => void;
  restoring: boolean;
}) {
  const deletedBy = useDeletedBy(task.id);
  const key = task.key ?? `${task.project.identifier}-${task.sequenceNumber}`;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="w-16 shrink-0 font-mono text-xs text-neutral-500">{key}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-800">{task.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
          {task.state && (
            <span className="inline-flex items-center gap-1">
              <ColorDot color={task.state.color} size="xs" />
              {task.state.name}
            </span>
          )}
          <span>
            Deleted
            {deletedBy.data ? ` by ${deletedBy.data}` : ''}{' '}
            {task.deletedAt && (
              <time dateTime={task.deletedAt} title={formatDateTime(task.deletedAt)}>
                {relativeTime(task.deletedAt)}
              </time>
            )}
          </span>
        </p>
      </div>
      <button
        type="button"
        onClick={onRestore}
        disabled={restoring}
        className="btn btn-secondary shrink-0 px-3 py-1.5 text-sm"
        aria-label={`Restore ${key}: ${task.title}`}
      >
        {restoring ? (
          <Spinner size="sm" label="Restoring" />
        ) : (
          <RotateCcw aria-hidden className="mr-1.5 h-4 w-4" />
        )}
        Restore
      </button>
    </li>
  );
}

export function TrashPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [page, setPage] = useState(1);
  const { data: project } = useProject(projectId);
  const trash = useTrash(projectId, page, PAGE_SIZE);
  const restore = useRestoreTask();
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());
  const [confirmAll, setConfirmAll] = useState(false);

  const tasks = trash.data?.data ?? [];
  const meta = trash.data?.meta;
  const total = meta?.total ?? tasks.length;
  const pages = meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1;

  const restoreOne = async (task: TaskDto) => {
    if (!projectId) return;
    setRestoringIds((s) => new Set(s).add(task.id));
    try {
      await restore.mutateAsync({ projectId, taskId: task.id });
      toast.success(`Restored ${task.key ?? task.title}`);
    } catch {
      // toasted globally
    } finally {
      setRestoringIds((s) => {
        const next = new Set(s);
        next.delete(task.id);
        return next;
      });
    }
  };

  const restoreAll = async () => {
    if (!projectId) return;
    // Every page: restore what is listed, then refetch until the trash is empty.
    let restored = 0;
    let failed = 0;
    for (let round = 0; round < 20; round++) {
      const batch = (await trashApi.list(projectId, { page: 1, limit: 100 })).data;
      if (batch.length === 0) break;
      const results = await Promise.allSettled(
        batch.map((t) => restore.mutateAsync({ projectId, taskId: t.id }))
      );
      restored += results.filter((r) => r.status === 'fulfilled').length;
      failed += results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) break;
    }
    setPage(1);
    if (failed > 0) toast.error(`Restored ${restored}, ${failed} failed`);
    else toast.success(`Restored ${restored} task${restored === 1 ? '' : 's'}`);
  };

  if (trash.isLoading) return <PageSpinner label="Loading trash" />;
  if (trash.isError && !trash.data) {
    return <ErrorState error={trash.error} resource="trash" onRetry={() => void trash.refetch()} />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to={projectId ? `/project/${projectId}` : '/projects'}
        className="mb-4 inline-flex items-center text-sm text-neutral-600 hover:text-neutral-900"
      >
        <ArrowLeft aria-hidden className="mr-1 h-4 w-4" />
        Back to {project?.name ?? 'project'}
      </Link>
      <header className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-neutral-900">Trash</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Deleted tasks stay here for {meta?.retentionDays ?? 30} days, then they are removed for
            good.
          </p>
        </div>
        {total > 0 && (
          <button type="button" className="btn btn-secondary" onClick={() => setConfirmAll(true)}>
            <RotateCcw aria-hidden className="mr-2 h-4 w-4" />
            Restore all ({total})
          </button>
        )}
      </header>

      {tasks.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Trash2 />}
            title="The trash is empty"
            body="Deleted tasks of this project appear here."
          />
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <ul aria-label="Deleted tasks" className="divide-y divide-neutral-100">
            {tasks.map((task) => (
              <TrashRow
                key={task.id}
                task={task}
                restoring={restoringIds.has(task.id)}
                onRestore={() => void restoreOne(task)}
              />
            ))}
          </ul>
          {pages > 1 && (
            <nav
              aria-label="Trash pages"
              className="flex items-center justify-between border-t border-neutral-100 px-4 py-2 text-sm"
            >
              <button
                type="button"
                className="btn btn-ghost px-2 py-1"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span className="text-neutral-500">
                Page {page} of {pages}
              </span>
              <button
                type="button"
                className="btn btn-ghost px-2 py-1"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={`Restore all ${total} tasks?`}
        description="They go back to their columns on the board."
        confirmLabel="Restore all"
        onConfirm={restoreAll}
      />
    </div>
  );
}
