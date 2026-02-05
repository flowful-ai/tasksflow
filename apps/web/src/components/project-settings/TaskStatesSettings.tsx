import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../api/client';

interface TaskState {
  id: string;
  name: string;
  category: 'backlog' | 'in_progress' | 'done';
  color: string | null;
  position: string;
}

interface TaskStatesSettingsProps {
  projectId: string;
  states: TaskState[];
  onUpdated: () => void;
}

interface EditableState extends TaskState {
  colorTouched: boolean;
}

const CATEGORY_LABELS: Record<TaskState['category'], string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  done: 'Done',
};

export function TaskStatesSettings({ projectId, states, onUpdated }: TaskStatesSettingsProps) {
  const [editStates, setEditStates] = useState<EditableState[]>([]);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<TaskState['category']>('backlog');
  const [newColor, setNewColor] = useState('#9ca3af');
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskState | null>(null);

  useEffect(() => {
    setEditStates(
      states.map((state) => ({
        ...state,
        colorTouched: false,
      }))
    );
  }, [states]);

  const createMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/api/projects/${projectId}/states`, {
        name: newName.trim(),
        category: newCategory,
        color: newColor || undefined,
      });
    },
    onSuccess: () => {
      setNewName('');
      setNewCategory('backlog');
      setNewColor('#9ca3af');
      setError(null);
      onUpdated();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { stateId: string; name: string; color?: string | null }) => {
      return api.patch(`/api/projects/${projectId}/states/${payload.stateId}`, {
        name: payload.name,
        ...(payload.color !== undefined ? { color: payload.color } : {}),
      });
    },
    onSuccess: () => {
      setError(null);
      onUpdated();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (stateId: string) => {
      return api.delete(`/api/projects/${projectId}/states/${stateId}`);
    },
    onSuccess: () => {
      setDeleteTarget(null);
      setError(null);
      onUpdated();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleUpdate = (state: EditableState) => {
    if (!state.name.trim()) {
      setError('State name is required.');
      return;
    }
    updateMutation.mutate({
      stateId: state.id,
      name: state.name.trim(),
      color: state.colorTouched ? state.color : undefined,
    });
  };

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) {
      setError('State name is required.');
      return;
    }
    setError(null);
    createMutation.mutate();
  };

  return (
    <div className="card p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Task States</h2>
        <p className="text-sm text-gray-500">Configure your kanban columns.</p>
      </div>

      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg mb-4">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {editStates.map((state) => (
          <div key={state.id} className="flex flex-col gap-3 border border-gray-200 rounded-lg p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                className="input flex-1 min-w-[200px]"
                value={state.name}
                onChange={(event) =>
                  setEditStates((prev) =>
                    prev.map((item) =>
                      item.id === state.id ? { ...item, name: event.target.value } : item
                    )
                  )
                }
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

              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-500 uppercase">Color</span>
                <input
                  type="color"
                  value={state.color || '#9ca3af'}
                  onChange={(event) =>
                    setEditStates((prev) =>
                      prev.map((item) =>
                        item.id === state.id
                          ? { ...item, color: event.target.value, colorTouched: true }
                          : item
                      )
                    )
                  }
                  className="h-9 w-12 border border-gray-200 rounded-lg"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => handleUpdate(state)}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                className="btn bg-red-50 text-red-600 hover:bg-red-100"
                onClick={() => setDeleteTarget(state)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleCreate} className="mt-6 border-t border-gray-200 pt-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Add State</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              className="input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="e.g. In Review"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value as TaskState['category'])}
              className="input"
            >
              <option value="backlog">Backlog</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
            <input
              type="color"
              value={newColor}
              onChange={(event) => setNewColor(event.target.value)}
              className="h-10 w-full border border-gray-200 rounded-lg"
            />
          </div>
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={createMutation.isPending || !newName.trim()}
        >
          {createMutation.isPending ? 'Adding...' : 'Add State'}
        </button>
      </form>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDeleteTarget(null)}
          />
          <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete State</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete "{deleteTarget.name}"? Tasks in this state may become
              unassigned.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                className="btn bg-red-600 text-white hover:bg-red-700"
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
