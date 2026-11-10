import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { TaskStateCategorySchema, type TaskStateCategory } from '@flowtask/shared/types';
import type { TaskStateDto } from '../../api/types';
import { useTaskStateMutations } from '../../hooks/queries';
import {
  Badge,
  Button,
  Card,
  ColorDot,
  ConfirmDialog,
  Field,
  Input,
  Panel,
  Select,
  toast,
  type BadgeTone,
} from '../ui';

interface TaskStatesSettingsProps {
  projectId: string;
  states: TaskStateDto[];
}

interface EditableState extends TaskStateDto {
  colorTouched: boolean;
}

const CATEGORY_LABELS: Record<TaskStateCategory, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  done: 'Done',
};

const CATEGORY_TONES: Record<TaskStateCategory, BadgeTone> = {
  backlog: 'neutral',
  in_progress: 'info',
  done: 'success',
};

const DEFAULT_COLOR = '#9ca3af';

function isCategory(value: string): value is TaskStateCategory {
  return TaskStateCategorySchema.safeParse(value).success;
}

export function TaskStatesSettings({ projectId, states }: TaskStatesSettingsProps) {
  const { create, update, remove } = useTaskStateMutations(projectId);
  const [editStates, setEditStates] = useState<EditableState[]>([]);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<TaskStateCategory>('backlog');
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);
  const [deleteTarget, setDeleteTarget] = useState<TaskStateDto | null>(null);

  useEffect(() => {
    setEditStates(states.map((state) => ({ ...state, colorTouched: false })));
  }, [states]);

  const patchLocal = (id: string, patch: Partial<EditableState>) =>
    setEditStates((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const handleUpdate = (state: EditableState) => {
    if (!state.name.trim()) {
      toast.error('State name is required.');
      return;
    }
    update.mutate(
      {
        stateId: state.id,
        name: state.name.trim(),
        ...(state.colorTouched && state.color ? { color: state.color } : {}),
      },
      { onSuccess: () => toast.success('State saved') }
    );
  };

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    create.mutate(
      { name: newName.trim(), category: newCategory, color: newColor || undefined },
      {
        onSuccess: (state) => {
          setNewName('');
          setNewCategory('backlog');
          setNewColor(DEFAULT_COLOR);
          toast.success(`State ${state.name} added`);
        },
      }
    );
  };

  return (
    <Card title="Task States" description="Configure your kanban columns.">
      <ul className="space-y-3">
        {editStates.map((state) => {
          const isSaving = update.isPending && update.variables?.stateId === state.id;
          return (
            <li key={state.id}>
              <Panel className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <ColorDot color={state.color} size="md" />
                  <Input
                    aria-label="State name"
                    className="flex-1 min-w-[200px]"
                    value={state.name}
                    onChange={(e) => patchLocal(state.id, { name: e.target.value })}
                  />

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-neutral-500 uppercase">
                      Category
                    </span>
                    <Badge shape="pill" tone={CATEGORY_TONES[state.category]}>
                      {CATEGORY_LABELS[state.category]}
                    </Badge>
                  </div>

                  <label className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-neutral-500 uppercase">Color</span>
                    <input
                      type="color"
                      value={state.color || DEFAULT_COLOR}
                      onChange={(e) =>
                        patchLocal(state.id, { color: e.target.value, colorTouched: true })
                      }
                      className="h-9 w-12 border border-neutral-200 rounded-lg"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => handleUpdate(state)}
                    disabled={isSaving}
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    variant="secondary"
                    className="bg-red-50 text-red-700 hover:bg-red-100"
                    onClick={() => setDeleteTarget(state)}
                    leadingIcon={<Trash2 />}
                  >
                    Delete
                  </Button>
                </div>
              </Panel>
            </li>
          );
        })}
      </ul>

      <form onSubmit={handleCreate} className="mt-6 border-t border-neutral-200 pt-4 space-y-4">
        <h3 className="text-sm font-semibold text-neutral-700">Add State</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" id="new-state-name" className="sm:col-span-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. In Review"
            />
          </Field>
          <Field label="Category" id="new-state-category">
            <Select
              value={newCategory}
              onChange={(e) => {
                if (isCategory(e.target.value)) setNewCategory(e.target.value);
              }}
            >
              <option value="backlog">Backlog</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
            </Select>
          </Field>
          <Field label="Color" id="new-state-color">
            <input
              id="new-state-color"
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="h-10 w-full border border-neutral-200 rounded-lg"
            />
          </Field>
        </div>
        <Button type="submit" disabled={create.isPending || !newName.trim()}>
          {create.isPending ? 'Adding...' : 'Add State'}
        </Button>
      </form>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete state "${deleteTarget?.name ?? ''}"?`}
        description="Tasks in this state may lose their column. This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await remove.mutateAsync(deleteTarget.id);
          toast.success('State deleted');
        }}
      />
    </Card>
  );
}
