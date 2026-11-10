import { useState, useEffect } from 'react';
import type { TaskPriority } from '@flowtask/shared';
import { useAuthStore } from '../../stores/auth';
import { useCreateTask, useGitHubIntegration, useTask, useUpdateTask } from '../../hooks/queries';
import { Button, Checkbox, Dialog, Field, Input, Select, Textarea } from '../ui';

const PRIORITIES: readonly TaskPriority[] = ['urgent', 'high', 'medium', 'low', 'none'];

export function isTaskPriority(value: string): value is TaskPriority {
  return PRIORITIES.some((p) => p === value);
}

interface TaskModalProps {
  taskId?: string;
  projectId: string;
  states: { id: string; name: string }[];
  /** Pre-selected status for a new task (column "+"). */
  defaultStateId?: string;
  onClose: () => void;
  onCreated?: () => void;
  onUpdated?: () => void;
}

/** Create (or edit) a task. Render it while open; closing unmounts it. */
export function TaskModal({
  taskId,
  projectId,
  states,
  defaultStateId,
  onClose,
  onCreated,
  onUpdated,
}: TaskModalProps) {
  const isEditing = !!taskId;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stateId, setStateId] = useState(defaultStateId ?? '');
  const [priority, setPriority] = useState('');
  const [assignToMe, setAssignToMe] = useState(false);
  const [createOnGitHub, setCreateOnGitHub] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<{ owner: string; repo: string } | null>(null);

  const currentUserId = useAuthStore((state) => state.user?.id);

  const { data: task } = useTask(taskId, { enabled: isEditing });

  // Populate form when task data loads
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setStateId(task.stateId || '');
      setPriority(task.priority || '');
    }
  }, [task]);

  // Set default state for new tasks
  useEffect(() => {
    if (!isEditing && states.length > 0 && !stateId) {
      setStateId(states[0].id);
    }
  }, [isEditing, states, stateId]);

  const { data: githubIntegration } = useGitHubIntegration(isEditing ? null : projectId);
  const linkedRepos = githubIntegration?.repositories || [];
  const hasGitHub = linkedRepos.length > 0;

  const createMutation = useCreateTask();
  const updateMutation = useUpdateTask();
  const priorityValue = isTaskPriority(priority) ? priority : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Errors are toasted by the global mutation handler; the dialog stays open.
    if (isEditing && taskId) {
      await updateMutation.mutateAsync({
        taskId,
        title,
        description,
        stateId: stateId || undefined,
        priority: priorityValue ?? null,
      });
      onUpdated?.();
    } else {
      await createMutation.mutateAsync({
        projectId,
        title,
        description: description || undefined,
        stateId: stateId || undefined,
        priority: priorityValue,
        assigneeIds: assignToMe && currentUserId ? [currentUserId] : undefined,
        createOnGitHub: createOnGitHub && selectedRepo ? true : undefined,
        githubRepo: createOnGitHub && selectedRepo ? selectedRepo : undefined,
      });
      onCreated?.();
    }
  };

  const submit = (e: React.FormEvent) => {
    handleSubmit(e).catch(() => undefined);
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={isEditing ? 'Edit task' : 'New task'}
      size="lg"
      dismissible={!isLoading}
      bodyClassName="p-0!"
    >
      {/* Form */}
      <form onSubmit={submit} className="p-4 space-y-4">
        <Field label="Title" id="task-title" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            autoFocus
          />
        </Field>

        <Field label="Description" id="task-description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[100px]"
            placeholder="Add a description..."
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Status" id="task-status">
            <Select value={stateId} onChange={(e) => setStateId(e.target.value)}>
              <option value="">Select status</option>
              {states.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" id="task-priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">No priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          </Field>
        </div>

        {/* Assign to me - only show for new tasks */}
        {!isEditing && (
          <div className="pt-2 border-t border-neutral-100">
            <Checkbox
              id="assignToMe"
              checked={assignToMe}
              onChange={(e) => setAssignToMe(e.target.checked)}
              label="Assign to me"
            />
          </div>
        )}

        {/* GitHub Integration - only show for new tasks when repos are linked */}
        {!isEditing && hasGitHub && (
          <div className="pt-2 space-y-2 border-t border-neutral-100">
            <Checkbox
              id="createOnGitHub"
              checked={createOnGitHub}
              onChange={(e) => {
                setCreateOnGitHub(e.target.checked);
                if (e.target.checked && linkedRepos.length === 1) {
                  setSelectedRepo({
                    owner: linkedRepos[0].owner,
                    repo: linkedRepos[0].repo,
                  });
                }
                if (!e.target.checked) {
                  setSelectedRepo(null);
                }
              }}
              label="Also create GitHub issue"
            />

            {createOnGitHub && linkedRepos.length > 1 && (
              <Select
                aria-label="GitHub repository"
                value={selectedRepo ? `${selectedRepo.owner}/${selectedRepo.repo}` : ''}
                onChange={(e) => {
                  const [owner, repo] = e.target.value.split('/');
                  setSelectedRepo(owner && repo ? { owner, repo } : null);
                }}
              >
                <option value="">Select repository</option>
                {linkedRepos.map((r) => (
                  <option key={`${r.owner}/${r.repo}`} value={`${r.owner}/${r.repo}`}>
                    {r.owner}/{r.repo}
                  </option>
                ))}
              </Select>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end space-x-3 pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!title.trim()} loading={isLoading}>
            {isLoading ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Task'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
