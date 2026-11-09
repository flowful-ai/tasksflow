import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { TaskStateCategorySchema, type TaskStateCategory } from '@flowtask/shared/types';
import type { TaskStateDto } from '../../api/types';
import { useTaskStateMutations } from '../../hooks/queries';
import { ColorDot, ConfirmDialog, toast } from '../ui';

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
    <div className="card p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Task States</h2>
        <p className="text-sm text-gray-500">Configure your kanban columns.</p>
      </div>

      <ul className="space-y-3">
        {editStates.map((state) => {
          const isSaving = update.isPending && update.variables?.stateId === state.id;
          return (
            <li key={state.id} className="flex flex-col gap-3 border border-gray-200 rounded-lg p-4">
              <div className="flex flex-wrap items-center gap-3">
                <ColorDot color={state.color} size="md" />
                <label htmlFor={`state-name-${state.id}`} className="sr-only">
                  State name
                </label>
                <input
                  id={`state-name-${state.id}`}
                  type="text"
                  className="input flex-1 min-w-[200px]"
                  value={state.name}
                  onChange={(e) => patchLocal(state.id, { name: e.target.value })}
                />

                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase">Category</span>
                  <span
                    className={clsx(
                      'px-2 py-1 rounded-full text-xs font-medium',
                      state.category === 'done'
                        ? 'bg-green-100 text-green-700'
                        : state.category === 'in_progress'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-700'
                    )}
                  >
                    {CATEGORY_LABELS[state.category]}
                  </span>
                </div>

                <label className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase">Color</span>
                  <input
                    type="color"
                    value={state.color || DEFAULT_COLOR}
                    onChange={(e) => patchLocal(state.id, { color: e.target.value, colorTouched: true })}
                    className="h-9 w-12 border border-gray-200 rounded-lg"
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary" onClick={() => handleUpdate(state)} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  className="btn bg-red-50 text-red-700 hover:bg-red-100"
                  onClick={() => setDeleteTarget(state)}
                >
                  <Trash2 aria-hidden className="w-4 h-4 mr-2" />
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <form onSubmit={handleCreate} className="mt-6 border-t border-gray-200 pt-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Add State</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor="new-state-name" className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              id="new-state-name"
              type="text"
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. In Review"
            />
          </div>
          <div>
            <label htmlFor="new-state-category" className="block text-sm font-medium text-gray-700 mb-1">
              Category
            </label>
            <select
              id="new-state-category"
              value={newCategory}
              onChange={(e) => {
                if (isCategory(e.target.value)) setNewCategory(e.target.value);
              }}
              className="input"
            >
              <option value="backlog">Backlog</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div>
            <label htmlFor="new-state-color" className="block text-sm font-medium text-gray-700 mb-1">
              Color
            </label>
            <input
              id="new-state-color"
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="h-10 w-full border border-gray-200 rounded-lg"
            />
          </div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={create.isPending || !newName.trim()}>
          {create.isPending ? 'Adding...' : 'Add State'}
        </button>
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
    </div>
  );
}
