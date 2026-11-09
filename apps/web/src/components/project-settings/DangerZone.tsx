import { useState } from 'react';
import { AlertTriangle, Trash2, Archive, ArchiveRestore } from 'lucide-react';
import type { ProjectDetailDto } from '../../api/types';
import { useDeleteProject, useUpdateProject } from '../../hooks/queries';
import { ConfirmDialog, toast } from '../ui';

interface DangerZoneProps {
  project: Pick<ProjectDetailDto, 'id' | 'name' | 'isArchived'>;
  onDeleted: () => void;
}

export function DangerZone({ project, onDeleted }: DangerZoneProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const updateProject = useUpdateProject(project.id);
  const deleteProject = useDeleteProject();
  const isArchived = project.isArchived;

  return (
    <section aria-labelledby="danger-heading" className="card p-6 border border-red-100">
      <div className="mb-4 flex items-center gap-2">
        <AlertTriangle aria-hidden className="w-5 h-5 text-red-600" />
        <h2 id="danger-heading" className="text-lg font-semibold text-neutral-900">
          Danger Zone
        </h2>
      </div>
      <p className="text-sm text-neutral-600 mb-4">
        Actions here are destructive. Please proceed with caution.
      </p>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-neutral-200 rounded-lg p-4">
          <div>
            <h3 className="font-medium text-neutral-900">
              {isArchived ? 'Unarchive Project' : 'Archive Project'}
            </h3>
            <p className="text-sm text-neutral-500">
              {isArchived
                ? 'Restore this project and make it visible again.'
                : 'Hide this project from active lists.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              updateProject.mutate(
                { isArchived: !isArchived },
                {
                  onSuccess: () =>
                    toast.success(isArchived ? 'Project restored' : 'Project archived'),
                }
              )
            }
            className="btn btn-secondary"
            disabled={updateProject.isPending}
          >
            {isArchived ? (
              <ArchiveRestore aria-hidden className="w-4 h-4 mr-2" />
            ) : (
              <Archive aria-hidden className="w-4 h-4 mr-2" />
            )}
            {isArchived
              ? updateProject.isPending
                ? 'Restoring...'
                : 'Unarchive'
              : updateProject.isPending
                ? 'Archiving...'
                : 'Archive'}
          </button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-red-200 rounded-lg p-4 bg-red-50/40">
          <div>
            <h3 className="font-medium text-neutral-900">Delete Project</h3>
            <p className="text-sm text-neutral-500">
              Permanently delete this project and all associated tasks.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setConfirmName('');
              setShowDeleteConfirm(true);
            }}
            className="btn btn-danger"
          >
            <Trash2 aria-hidden className="w-4 h-4 mr-2" />
            Delete
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={`Delete "${project.name}"?`}
        description="The project and all its tasks are deleted. This action cannot be undone."
        confirmLabel="Delete project"
        variant="danger"
        confirmDisabled={confirmName.trim() !== project.name}
        onConfirm={async () => {
          await deleteProject.mutateAsync(project.id);
          toast.success(`Deleted ${project.name}`);
          onDeleted();
        }}
      >
        <label htmlFor="confirm-project-name" className="block text-sm text-neutral-700">
          Type <strong className="font-semibold">{project.name}</strong> to confirm
        </label>
        <input
          id="confirm-project-name"
          className="input mt-1"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          autoComplete="off"
        />
      </ConfirmDialog>
    </section>
  );
}
