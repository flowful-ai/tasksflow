/**
 * Pure helpers that patch cached task lists (optimistic updates and realtime
 * events). They never mutate their input and return the same reference when
 * nothing changed, so React Query skips needless re-renders.
 *
 * Two cached shapes hold tasks:
 *  - project lists: InfiniteData<ApiEnvelope<TaskDto[], PageMeta>>  (useProjectTasks)
 *  - smart views:   InfiniteData<SmartViewExecuteDto>                (useSmartViewTasks)
 */
import type { InfiniteData } from '@tanstack/react-query';
import { comparePositions, generatePosition } from '@flowtask/shared/utils';
import type { ApiEnvelope, PageMeta } from '../../api/http';
import type { MoveTaskInput, SmartViewExecuteDto, TaskDto, TaskStateDto } from '../../api/types';

export type TaskListPage = ApiEnvelope<TaskDto[], PageMeta>;
export type TaskPages = InfiniteData<TaskListPage>;
export type SmartViewPages = InfiniteData<SmartViewExecuteDto>;

interface PageAdapter<P> {
  read: (page: P) => TaskDto[];
  write: (page: P, tasks: TaskDto[], totalDelta: number) => P;
}

export const taskListAdapter: PageAdapter<TaskListPage> = {
  read: (page) => page.data,
  write: (page, tasks, totalDelta) => ({
    ...page,
    data: tasks,
    ...(page.meta
      ? { meta: { ...page.meta, total: Math.max(0, page.meta.total + totalDelta) } }
      : {}),
  }),
};

export const smartViewAdapter: PageAdapter<SmartViewExecuteDto> = {
  read: (page) => page.tasks,
  write: (page, tasks, totalDelta) => ({
    ...page,
    tasks,
    meta: { ...page.meta, total: Math.max(0, page.meta.total + totalDelta) },
  }),
};

/** All tasks of an infinite list, in order, without duplicates (pages can overlap after inserts). */
export function flattenPages<P>(
  data: InfiniteData<P> | undefined,
  adapter: PageAdapter<P>
): TaskDto[] {
  if (!data) return [];
  const seen = new Set<string>();
  const tasks: TaskDto[] = [];
  for (const page of data.pages) {
    for (const task of adapter.read(page)) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      tasks.push(task);
    }
  }
  return tasks;
}

/** Split `tasks` back into pages of the original sizes (the last page takes any extra). */
function resplit<P>(
  data: InfiniteData<P>,
  adapter: PageAdapter<P>,
  tasks: TaskDto[],
  totalDelta: number
): InfiniteData<P> {
  let offset = 0;
  const pages = data.pages.map((page, index) => {
    const size = adapter.read(page).length;
    const isLast = index === data.pages.length - 1;
    const slice = isLast ? tasks.slice(offset) : tasks.slice(offset, offset + size);
    offset += slice.length;
    // Every page carries the total; keep them consistent.
    return adapter.write(page, slice, totalDelta);
  });
  return { ...data, pages };
}

function contains<P>(data: InfiniteData<P>, adapter: PageAdapter<P>, taskId: string): boolean {
  return data.pages.some((page) => adapter.read(page).some((task) => task.id === taskId));
}

/**
 * Replace a task (merging over the cached copy), or append it to the last page
 * when `appendIfMissing` (a task created elsewhere).
 */
export function upsertTask<P>(
  data: InfiniteData<P> | undefined,
  adapter: PageAdapter<P>,
  task: TaskDto,
  options: { appendIfMissing?: boolean } = {}
): InfiniteData<P> | undefined {
  if (!data || data.pages.length === 0) return data;
  if (contains(data, adapter, task.id)) {
    return {
      ...data,
      pages: data.pages.map((page) => {
        const tasks = adapter.read(page);
        if (!tasks.some((t) => t.id === task.id)) return page;
        return adapter.write(
          page,
          tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)),
          0
        );
      }),
    };
  }
  if (!options.appendIfMissing) return data;
  const all = [...flattenPages(data, adapter), task];
  return resplit(data, adapter, all, 1);
}

export function removeTask<P>(
  data: InfiniteData<P> | undefined,
  adapter: PageAdapter<P>,
  taskId: string
): InfiniteData<P> | undefined {
  if (!data || !contains(data, adapter, taskId)) return data;
  return resplit(
    data,
    adapter,
    flattenPages(data, adapter).filter((t) => t.id !== taskId),
    -1
  );
}

/** Fractional key between two neighbours, or null when their keys are unusable. */
export function positionBetweenNeighbours(
  above: TaskDto | undefined,
  below: TaskDto | undefined
): string | null {
  try {
    return generatePosition(above?.position ?? null, below?.position ?? null);
  } catch {
    return null;
  }
}

/**
 * Move a task in a flat list: set its state, put it after `afterTaskId` (or
 * before `beforeTaskId`, or at the end of the target column) and give it an
 * approximate position. The server's answer replaces it on settle.
 */
export function moveTaskInList(
  tasks: TaskDto[],
  input: MoveTaskInput,
  state: TaskStateDto | null
): TaskDto[] {
  const current = tasks.find((t) => t.id === input.taskId);
  if (!current) return tasks;
  const rest = tasks.filter((t) => t.id !== input.taskId);

  let index = -1;
  if (input.afterTaskId) {
    const i = rest.findIndex((t) => t.id === input.afterTaskId);
    if (i >= 0) index = i + 1;
  }
  if (index < 0 && input.beforeTaskId) {
    const i = rest.findIndex((t) => t.id === input.beforeTaskId);
    if (i >= 0) index = i;
  }
  if (index < 0) {
    let lastInColumn = -1;
    rest.forEach((t, i) => {
      if (t.stateId === input.stateId) lastInColumn = i;
    });
    index = lastInColumn >= 0 ? lastInColumn + 1 : rest.length;
  }

  // The key goes between the named neighbours (the board sorts by key, so the
  // card shows where it was dropped); without neighbours, after the column's
  // last key, as the server does.
  const sameColumn = (t: TaskDto) =>
    t.stateId === input.stateId && t.projectId === current.projectId;
  const byId = (id: string | null | undefined) =>
    id ? rest.find((t) => t.id === id && sameColumn(t)) : undefined;
  let above = byId(input.afterTaskId);
  let below = byId(input.beforeTaskId);
  if (!input.afterTaskId && !input.beforeTaskId) {
    above = rest
      .filter(sameColumn)
      .reduce<
        TaskDto | undefined
      >((last, t) => (!last || comparePositions(last.position, t.position) < 0 ? t : last), undefined);
  } else if (above && !below && input.beforeTaskId === undefined) {
    // Only afterTaskId given: the next key in the column is the upper bound.
    const anchor = above.position;
    below = rest
      .filter((t) => sameColumn(t) && comparePositions(anchor, t.position) < 0)
      .reduce<
        TaskDto | undefined
      >((first, t) => (!first || comparePositions(t.position, first.position) < 0 ? t : first), undefined);
  }
  const position = positionBetweenNeighbours(above, below) ?? current.position;

  const changedState = current.stateId !== input.stateId;
  const moved: TaskDto = {
    ...current,
    stateId: input.stateId,
    state: state ?? (current.state ? { ...current.state, id: input.stateId } : null),
    position,
    // Mirror the server: a state change bumps updatedAt, entering done stamps
    // completedAt (done → done keeps it), leaving done clears it.
    ...(changedState
      ? {
          updatedAt: new Date().toISOString(),
          completedAt:
            state?.category === 'done' ? (current.completedAt ?? new Date().toISOString()) : null,
        }
      : {}),
  };
  return [...rest.slice(0, index), moved, ...rest.slice(index)];
}

export function moveTaskInPages<P>(
  data: InfiniteData<P> | undefined,
  adapter: PageAdapter<P>,
  input: MoveTaskInput,
  state: TaskStateDto | null
): InfiniteData<P> | undefined {
  if (!data || !contains(data, adapter, input.taskId)) return data;
  return resplit(data, adapter, moveTaskInList(flattenPages(data, adapter), input, state), 0);
}

/** Find a cached state object for `stateId` among the tasks (fallback when the project isn't cached). */
export function findStateInTasks(tasks: TaskDto[], stateId: string): TaskStateDto | null {
  return tasks.find((t) => t.state?.id === stateId)?.state ?? null;
}
