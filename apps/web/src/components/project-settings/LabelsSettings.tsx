import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api } from '../../api/client';

interface ProjectLabel {
  id: string;
  name: string;
  color: string | null;
}

interface LabelsSettingsProps {
  projectId: string;
  labels: ProjectLabel[];
  onUpdated: () => void;
}

interface EditableLabel extends ProjectLabel {
  colorTouched: boolean;
}

export function LabelsSettings({ projectId, labels, onUpdated }: LabelsSettingsProps) {
  const [editLabels, setEditLabels] = useState<EditableLabel[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#9ca3af');
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectLabel | null>(null);

  useEffect(() => {
    setEditLabels(
      labels.map((label) => ({
        ...label,
        colorTouched: false,
      }))
    );
  }, [labels]);

  const createMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/api/projects/${projectId}/labels`, {
        name: newName.trim(),
        color: newColor || undefined,
      });
    },
    onSuccess: () => {
      setNewName('');
      setNewColor('#9ca3af');
      setError(null);
      onUpdated();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { labelId: string; name: string; color?: string | null }) => {
      return api.patch(`/api/projects/${projectId}/labels/${payload.labelId}`, {
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
    mutationFn: async (labelId: string) => {
      return api.delete(`/api/projects/${projectId}/labels/${labelId}`);
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

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) {
      setError('Label name is required.');
      return;
    }
    setError(null);
    createMutation.mutate();
  };

  const handleUpdate = (label: EditableLabel) => {
    if (!label.name.trim()) {
      setError('Label name is required.');
      return;
    }
    updateMutation.mutate({
      labelId: label.id,
      name: label.name.trim(),
      color: label.colorTouched ? label.color : undefined,
    });
  };

  return (
    <div className="card p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Labels</h2>
        <p className="text-sm text-gray-500">Organize tasks with labels.</p>
      </div>

      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg mb-4">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {editLabels.map((label) => (
          <div key={label.id} className="flex flex-col gap-3 border border-gray-200 rounded-lg p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                className="input flex-1 min-w-[200px]"
                value={label.name}
                onChange={(event) =>
                  setEditLabels((prev) =>
                    prev.map((item) =>
                      item.id === label.id ? { ...item, name: event.target.value } : item
                    )
                  )
                }
              />
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-500 uppercase">Color</span>
                <input
                  type="color"
                  value={label.color || '#9ca3af'}
                  onChange={(event) =>
                    setEditLabels((prev) =>
                      prev.map((item) =>
                        item.id === label.id
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
                onClick={() => handleUpdate(label)}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                className="btn bg-red-50 text-red-600 hover:bg-red-100"
                onClick={() => setDeleteTarget(label)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleCreate} className="mt-6 border-t border-gray-200 pt-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Add Label</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              className="input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="e.g. Bug"
            />
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
          {createMutation.isPending ? 'Adding...' : 'Add Label'}
        </button>
      </form>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteTarget(null)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Label</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete "{deleteTarget.name}"? This action cannot be undone.
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
