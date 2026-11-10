/**
 * Task detail in a right-docked sheet. The content lives in
 * ./detail/TaskDetailView (shared with the /task/:id page and the inbox).
 * Clicking a sub-task, parent or related task swaps the sheet to that task.
 */
import { useEffect, useState } from 'react';
import { Dialog } from '../ui';
import { useTask } from '../../hooks/queries';
import { TaskDetailView } from './detail/TaskDetailView';
import { taskKeyOf, type DetailState, type TaskDetail } from './detail/types';

export type { TaskDetail } from './detail/types';

interface TaskDetailSheetProps {
  taskId: string;
  /** Kept for compatibility; the project is read from the task. */
  projectId?: string;
  /** Optional: defaults to the task's project states. */
  states?: DetailState[];
  onClose: () => void;
  onUpdated?: () => void;
  readOnly?: boolean;
  /** Pre-loaded task data (for public share pages that already have the task) */
  initialTask?: TaskDetail;
}

export function TaskDetailSheet({
  taskId,
  states,
  onClose,
  onUpdated,
  readOnly = false,
  initialTask,
}: TaskDetailSheetProps) {
  const [currentId, setCurrentId] = useState(taskId);
  useEffect(() => setCurrentId(taskId), [taskId]);

  const { data } = useTask(currentId, { enabled: !initialTask && !readOnly });
  const task = initialTask ?? data;
  // Caller-provided states belong to the first task's project only.
  const stateOverride = currentId === taskId ? states : undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      size="full"
      title={task ? `${taskKeyOf(task)}: ${task.title}` : 'Task'}
      bare
      className="animate-slide-in-right sm:max-w-[1040px]!"
    >
      <TaskDetailView
        key={currentId}
        taskId={currentId}
        mode="sheet"
        onClose={onClose}
        onOpenTask={readOnly ? () => undefined : setCurrentId}
        readOnly={readOnly}
        initialTask={currentId === taskId ? initialTask : undefined}
        states={stateOverride}
        onUpdated={onUpdated}
      />
    </Dialog>
  );
}
