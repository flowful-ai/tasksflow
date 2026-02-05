import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Trash2, Archive, ArchiveRestore } from 'lucide-react';
import { api } from '../../api/client';
import { useWorkspaceStore } from '../../stores/workspace';

interface ProjectDangerData {
  id: string;
  name: string;
  isArchived: boolean;
}

interface DangerZoneProps {
  project: ProjectDangerData;
  onDeleted: () => void;
}

export function DangerZone({ project, onDeleted }: DangerZoneProps) {
  const { currentWorkspace, fetchProjects } = useWorkspaceStore();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isArchived, setIsArchived] = useState(project.isArchived);

  useEffect(() => {
    setIsArchived(project.isArchived);
  }, [project.isArchived]);

  const archiveMutation = useMutation({
    mutationFn: async () => {
      return api.patch(`/api/projects/${project.id}`, {
        isArchived: !isArchived,
      });
    },
    onSuccess: async () => {
      setError(null);
      setIsArchived((prev) => !prev);
      if (currentWorkspace) {
        await fetchProjects(currentWorkspace.id);
      }
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return api.delete(`/api/projects/${project.id}`);
    },
    onSuccess: async () => {
      setError(null);
      if (currentWorkspace) {
        await fetchProjects(currentWorkspace.id);
      }
      onDeleted();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  return (
    <div className="card p-6 border border-red-100">
      <div className="mb-4 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-red-600" />
        <h2 className="text-lg font-semibold text-gray-900">Danger Zone</h2>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        Actions here are destructive. Please proceed with caution.
      </p>

      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg mb-4">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-gray-200 rounded-lg p-4">
          <div>
            <h3 className="font-medium text-gray-900">
              {isArchived ? 'Unarchive Project' : 'Archive Project'}
            </h3>
            <p className="text-sm text-gray-500">
              {isArchived
                ? 'Restore this project and make it visible again.'
                : 'Hide this project from active lists.'}
            </p>
          </div>
          <button
            onClick={() => archiveMutation.mutate()}
            className="btn btn-secondary"
            disabled={archiveMutation.isPending}
          >
            {isArchived ? (
              <>
                <ArchiveRestore className="w-4 h-4 mr-2" />
                {archiveMutation.isPending ? 'Restoring...' : 'Unarchive'}
              </>
            ) : (
              <>
                <Archive className="w-4 h-4 mr-2" />
                {archiveMutation.isPending ? 'Archiving...' : 'Archive'}
              </>
            )}
          </button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-red-200 rounded-lg p-4 bg-red-50/40">
          <div>
            <h3 className="font-medium text-gray-900">Delete Project</h3>
            <p className="text-sm text-gray-500">
              Permanently delete this project and all associated tasks.
            </p>
          </div>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="btn bg-red-600 text-white hover:bg-red-700"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </button>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Project</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete "{project.name}"? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
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
