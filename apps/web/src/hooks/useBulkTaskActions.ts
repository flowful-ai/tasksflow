import type { BulkTaskOperation } from '@flowtask/shared';
import { toast } from '../components/ui/Toast';
import type { BulkAssignMode } from '../components/task-display/BulkTaskToolbar';
import { assignOperation, describeBulkSummary, resolveCancelStateId, resolveDoneStateId, setLabelsOperation } from '../lib/bulk';
import { summarizeBulk, useBulkTasks } from './queries/tasks';

interface BulkTask {
  id: string;
  project: { id: string };
  assignees: { id: string }[];
  labels: { id: string }[];
}

interface BulkState {
  id: string;
  name: string;
  category: string;
  projectId?: string;
}

/**
 * Bulk toolbar handlers backed by one POST /api/tasks/bulk per action.
 * States are resolved per project, so a cross-project selection (smart views)
 * sends one request per project for state changes.
 */
export function useBulkTaskActions(selected: BulkTask[], states: BulkState[], onDone: () => void) {
  const bulk = useBulkTasks();

  const run = async (action: string, groups: Array<{ taskIds: string[]; op: BulkTaskOperation }>, skipped = 0) => {
    const runnable = groups.filter((g) => g.taskIds.length > 0 && Object.keys(g.op).length > 0);
    if (runnable.length === 0) {
      toast.warning(`${action}: nothing to change.`);
      return;
    }
    let updated = 0;
    let unchanged = skipped;
    let failed = 0;
    for (const group of runnable) {
      const summary = summarizeBulk(await bulk.mutateAsync(group));
      updated += summary.updated;
      unchanged += summary.unchanged;
      failed += summary.failed;
    }
    const { level, message } = describeBulkSummary(action, { updated, unchanged, failed, results: [] });
    toast[level](message);
    if (failed === 0) onDone();
  };

  const ids = selected.map((t) => t.id);

  const byState = (resolve: (projectStates: BulkState[]) => string | null) => {
    const groups = new Map<string, string[]>();
    let skipped = 0;
    for (const task of selected) {
      const projectStates = states.filter((s) => (s.projectId ?? task.project.id) === task.project.id);
      const stateId = resolve(projectStates);
      if (!stateId) {
        skipped += 1;
        continue;
      }
      groups.set(stateId, [...(groups.get(stateId) ?? []), task.id]);
    }
    return { groups: [...groups].map(([stateId, taskIds]) => ({ taskIds, op: { stateId } })), skipped };
  };

  return {
    isPending: bulk.isPending,
    assign: (userId: string, mode: BulkAssignMode) =>
      run('Assign', [{ taskIds: ids, op: assignOperation(userId, mode, selected.flatMap((t) => t.assignees.map((a) => a.id))) }]),
    setLabels: (labelIds: string[]) =>
      run('Set labels', [{ taskIds: ids, op: setLabelsOperation(labelIds, selected.flatMap((t) => t.labels.map((l) => l.id))) }]),
    /**
     * Multi-project selections: labels belong to one project, so apply each
     * project's chosen labels to its own tasks. Projects with no chosen label
     * are skipped (not cleared) when some labels were chosen elsewhere.
     */
    setLabelsByProject: (labelsByProject: Map<string, string[]>) => {
      const anySelected = [...labelsByProject.values()].some((ids) => ids.length > 0);
      const projectIds = [...new Set(selected.map((t) => t.project.id))];
      let skipped = 0;
      const groups = projectIds.flatMap((projectId) => {
        const tasks = selected.filter((t) => t.project.id === projectId);
        const labelIds = labelsByProject.get(projectId) ?? [];
        if (anySelected && labelIds.length === 0) {
          skipped += tasks.length;
          return [];
        }
        return [
          {
            taskIds: tasks.map((t) => t.id),
            op: setLabelsOperation(labelIds, tasks.flatMap((t) => t.labels.map((l) => l.id))),
          },
        ];
      });
      return run('Set labels', groups, skipped);
    },
    moveToDone: () => {
      const { groups, skipped } = byState(resolveDoneStateId);
      return run('Move to Done', groups, skipped);
    },
    cancel: () => {
      const { groups, skipped } = byState(resolveCancelStateId);
      return run('Cancel', groups, skipped);
    },
    /** Callers confirm first (BulkTaskToolbar shows a ConfirmDialog). */
    remove: () => run('Delete', [{ taskIds: ids, op: { delete: true } }]),
  };
}
