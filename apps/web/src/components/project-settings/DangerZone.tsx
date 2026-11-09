import { useState } from 'react';
import { AlertTriangle, Trash2, Archive, ArchiveRestore } from 'lucide-react';
import type { ProjectDetailDto } from '../../api/types';
import { useDeleteProject, useUpdateProject } from '../../hooks/queries';
import { Button, Card, ConfirmDialog, Field, Input, Panel, toast } from '../ui';

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
    <Card title="Danger Zone" icon={<AlertTriangle />} tone="danger">
      <p className="text-sm text-neutral-600 mb-4">
        Actions here are destructive. Please proceed with caution.
      </p>

      <div className="space-y-4">
        <Panel className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
          <Button
            variant="secondary"
            onClick={() =>
              updateProject.mutate(
                { isArchived: !isArchived },
                {
                  onSuccess: () =>
                    toast.success(isArchived ? 'Project restored' : 'Project archived'),
                }
              )
            }
            disabled={updateProject.isPending}
            leadingIcon={isArchived ? <ArchiveRestore /> : <Archive />}
          >
            {isArchived
              ? updateProject.isPending
                ? 'Restoring...'
                : 'Unarchive'
              : updateProject.isPending
                ? 'Archiving...'
                : 'Archive'}
          </Button>
        </Panel>

        <Panel
          tone="danger"
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div>
            <h3 className="font-medium text-neutral-900">Delete Project</h3>
            <p className="text-sm text-neutral-500">
              Permanently delete this project and all associated tasks.
            </p>
          </div>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmName('');
              setShowDeleteConfirm(true);
            }}
            leadingIcon={<Trash2 />}
          >
            Delete
          </Button>
        </Panel>
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
        <Field
          id="confirm-project-name"
          label={
            <>
              Type <strong className="font-semibold">{project.name}</strong> to confirm
            </>
          }
          labelClassName="font-normal"
        >
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoComplete="off"
          />
        </Field>
      </ConfirmDialog>
    </Card>
  );
}
