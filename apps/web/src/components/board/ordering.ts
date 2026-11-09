/**
 * Board ordering. Non-done columns follow `position` in plain code-unit order
 * with the id as tiebreak, exactly like the server's
 * `ORDER BY position COLLATE "C", id`. Done columns show the most recently
 * completed first (approximated by `updatedAt`, which a move bumps).
 */
import { comparePositions } from '@flowtask/shared';

export interface OrderableTask {
  id: string;
  position?: string;
  updatedAt?: string | null;
}

function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function compareByPosition(a: OrderableTask, b: OrderableTask): number {
  return comparePositions(a.position ?? '', b.position ?? '') || compareIds(a.id, b.id);
}

function timeOf(value: string | null | undefined): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

export function compareByRecentlyCompleted(a: OrderableTask, b: OrderableTask): number {
  return timeOf(b.updatedAt) - timeOf(a.updatedAt) || compareIds(a.id, b.id);
}

export function isDoneCategory(category: string | undefined | null): boolean {
  return category === 'done';
}

/** A sorted copy of a column's tasks. */
export function sortColumnTasks<T extends OrderableTask>(tasks: readonly T[], category?: string | null): T[] {
  return [...tasks].sort(isDoneCategory(category) ? compareByRecentlyCompleted : compareByPosition);
}

export interface DropNeighbours {
  afterTaskId: string | null;
  beforeTaskId: string | null;
  /** 0-based index of the dragged card in the displayed column. */
  index: number;
  /** Cards in the displayed column, the dragged one included. */
  count: number;
}

/**
 * Neighbours for a drop, from the displayed order of the target column with
 * the dragged card at its landing index. Only cards for which `isSameColumn`
 * holds (same project and state as the target) can be neighbours: a merged
 * smart-view column mixes several server columns.
 */
export function neighboursAt(
  orderedIds: readonly string[],
  draggedId: string,
  isSameColumn: (taskId: string) => boolean = () => true
): DropNeighbours {
  const index = orderedIds.indexOf(draggedId);
  if (index < 0) return { afterTaskId: null, beforeTaskId: null, index: -1, count: orderedIds.length };
  let afterTaskId: string | null = null;
  for (let i = index - 1; i >= 0; i--) {
    const id = orderedIds[i]!;
    if (isSameColumn(id)) {
      afterTaskId = id;
      break;
    }
  }
  let beforeTaskId: string | null = null;
  for (let i = index + 1; i < orderedIds.length; i++) {
    const id = orderedIds[i]!;
    if (isSameColumn(id)) {
      beforeTaskId = id;
      break;
    }
  }
  return { afterTaskId, beforeTaskId, index, count: orderedIds.length };
}

/** Move `items[from]` to `to` (dnd-kit's arrayMove, without the dependency in pure code). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(to, 0, item);
  return next;
}
