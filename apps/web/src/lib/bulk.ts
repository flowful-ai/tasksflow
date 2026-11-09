/** Helpers shared by the project and smart-view bulk toolbars. */
import type { BulkTaskOperation } from '@flowtask/shared';
import type { BulkSummary } from '../hooks/queries/tasks';

interface StateLike {
  id: string;
  name: string;
  category: string;
}

/** The "Done" state of a project: exactly "Done", else a non-cancel done state, else any done state. */
export function resolveDoneStateId(states: readonly StateLike[]): string | null {
  const done = states.filter((s) => s.category === 'done');
  return (
    done.find((s) => s.name.trim().toLowerCase() === 'done')?.id ??
    done.find((s) => !/cancel/i.test(s.name))?.id ??
    done[0]?.id ??
    null
  );
}

export function resolveCancelStateId(states: readonly StateLike[]): string | null {
  return states.find((s) => s.category === 'done' && /cancel/i.test(s.name))?.id ?? null;
}

/** "Move to Done: 3 updated, 1 unchanged, 1 failed." and the toast level to use. */
export function describeBulkSummary(
  action: string,
  summary: BulkSummary
): { level: 'success' | 'warning' | 'error'; message: string } {
  const parts = [
    `${summary.updated} updated`,
    summary.unchanged > 0 ? `${summary.unchanged} unchanged` : null,
    summary.failed > 0 ? `${summary.failed} failed` : null,
  ].filter((p): p is string => p !== null);
  const level = summary.failed > 0 ? 'error' : summary.unchanged > 0 ? 'warning' : 'success';
  return { level, message: `${action}: ${parts.join(', ')}.` };
}

/** Assignment op: "add" adds the user; "replace" makes them the only assignee of every task. */
export function assignOperation(
  userId: string,
  mode: 'add' | 'replace',
  currentAssigneeIds: readonly string[]
): BulkTaskOperation {
  if (mode === 'add') return { addAssigneeIds: [userId] };
  const remove = currentAssigneeIds.filter((id) => id !== userId);
  return {
    addAssigneeIds: [userId],
    ...(remove.length > 0 ? { removeAssigneeIds: [...new Set(remove)] } : {}),
  };
}

/** Make every task carry exactly `labelIds`, given the labels currently on the selection. */
export function setLabelsOperation(
  labelIds: readonly string[],
  currentLabelIds: readonly string[]
): BulkTaskOperation {
  const remove = [...new Set(currentLabelIds)].filter((id) => !labelIds.includes(id));
  return {
    ...(labelIds.length > 0 ? { addLabelIds: [...labelIds] } : {}),
    ...(remove.length > 0 ? { removeLabelIds: remove } : {}),
  };
}
