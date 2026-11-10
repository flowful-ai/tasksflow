import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Lock, LogOut, Trash2 } from 'lucide-react';
import type { WorkspaceDetailDto, WorkspaceRole } from '../../api/types';
import {
  useCurrentWorkspace,
  useDeleteWorkspace,
  useLeaveWorkspace,
  useUpdateWorkspace,
  useWorkspaceRole,
} from '../../hooks/queries';
import {
  MAX_NAME_LENGTH,
  canEditWorkspace,
  canLeaveWorkspace,
  validateName,
} from '../../lib/account';
import { useAuthStore } from '../../stores/auth';
import { Button, Card, ConfirmDialog, Field, Input, Panel, Spinner, toast } from '../ui';

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

export function WorkspaceGeneralSettings() {
  const { workspace, isLoading } = useCurrentWorkspace();
  const { data: role, isPending: isRolePending } = useWorkspaceRole(workspace?.id);

  if (isLoading) {
    return (
      <Card className="flex justify-center">
        <Spinner label="Loading workspace" />
      </Card>
    );
  }
  if (!workspace) {
    return (
      <Card>
        <p className="text-neutral-600">You don't belong to a workspace yet.</p>
        <Button asChild className="mt-4">
          <Link to="/settings/workspace/new">Create a workspace</Link>
        </Button>
      </Card>
    );
  }
  return (
    // Keyed so the forms and dialogs reset when another workspace is selected.
    <div key={workspace.id} className="space-y-6">
      <GeneralCard workspace={workspace} role={role ?? null} isRolePending={isRolePending} />
      {role && <DangerZone workspace={workspace} role={role} />}
    </div>
  );
}

interface CardProps {
  workspace: WorkspaceDetailDto;
  role: WorkspaceRole | null;
  isRolePending: boolean;
}

function GeneralCard({ workspace, role, isRolePending }: CardProps) {
  const update = useUpdateWorkspace(workspace.id);
  const editable = canEditWorkspace(role);
  const [name, setName] = useState(workspace.name);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(workspace.name);
  }, [workspace.name]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = validateName(name, 'Workspace name');
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    update.mutate(
      { name: result.value },
      {
        onSuccess: () => toast.success('Workspace saved'),
        onError: (err) => setError(err.message),
      }
    );
  };

  return (
    <Card title="Workspace" description={`General details of ${workspace.name}.`}>
      {!editable && !isRolePending && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
          <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
          Only the workspace owner and admins can change these settings. You are a{' '}
          {ROLE_LABELS[role ?? 'member'].toLowerCase()}.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Name" id="workspace-name" error={error}>
          <Input
            value={name}
            maxLength={MAX_NAME_LENGTH}
            readOnly={!editable}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field
          label="Slug"
          id="workspace-slug"
          hint="The slug is set when the workspace is created and can't be changed."
        >
          <Input className="font-mono" value={workspace.slug} readOnly />
        </Field>

        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-neutral-500">Members</dt>
          <dd className="text-neutral-900">
            {workspace.members.length}{' '}
            <Link to="/settings/workspace/members" className="text-primary-600 hover:underline">
              Manage
            </Link>
          </dd>
          <dt className="text-neutral-500">Your role</dt>
          <dd className="text-neutral-900">{role ? ROLE_LABELS[role] : '—'}</dd>
        </dl>

        {editable && (
          <div className="pt-2">
            <Button type="submit" disabled={update.isPending || name.trim() === workspace.name}>
              {update.isPending ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function DangerZone({ workspace, role }: { workspace: WorkspaceDetailDto; role: WorkspaceRole }) {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const deleteWorkspace = useDeleteWorkspace();
  const leaveWorkspace = useLeaveWorkspace();
  const [dialog, setDialog] = useState<'delete' | 'leave' | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const isOwner = role === 'owner';
  const canLeave = canLeaveWorkspace(role, workspace.members);

  const goTo = (next: string | null) =>
    navigate(next ? '/' : '/settings/workspace/new', { replace: true });

  return (
    <Card tone="danger" title="Danger Zone" icon={<AlertTriangle />}>
      <div className="space-y-4">
        <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-medium text-neutral-900">Leave workspace</h3>
            <p className="text-sm text-neutral-500">
              {canLeave
                ? 'You lose access to its projects, tasks and views until someone invites you again.'
                : 'You are the only owner. Transfer ownership in Members before you leave.'}
            </p>
          </div>
          <Button
            variant="secondary"
            className="shrink-0"
            leadingIcon={<LogOut />}
            disabled={!canLeave || !userId}
            onClick={() => setDialog('leave')}
          >
            Leave
          </Button>
        </Panel>

        {isOwner && (
          <Panel
            tone="danger"
            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <h3 className="font-medium text-neutral-900">Delete workspace</h3>
              <p className="text-sm text-neutral-500">
                Permanently delete this workspace with all its projects, tasks and settings.
              </p>
            </div>
            <Button
              variant="danger"
              className="shrink-0"
              leadingIcon={<Trash2 />}
              onClick={() => {
                setConfirmName('');
                setDialog('delete');
              }}
            >
              Delete
            </Button>
          </Panel>
        )}
      </div>

      <ConfirmDialog
        open={dialog === 'leave'}
        onOpenChange={(open) => setDialog(open ? 'leave' : null)}
        title={`Leave "${workspace.name}"?`}
        description="You lose access right away. An owner or admin has to invite you to come back."
        confirmLabel="Leave workspace"
        variant="danger"
        onConfirm={async () => {
          if (!userId) return;
          const next = await leaveWorkspace.mutateAsync({ workspaceId: workspace.id, userId });
          toast.success(`You left ${workspace.name}`);
          void goTo(next);
        }}
      />

      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        title={`Delete "${workspace.name}"?`}
        description="Every project, task, comment and view in it is deleted for all members. This cannot be undone."
        confirmLabel="Delete workspace"
        variant="danger"
        confirmDisabled={confirmName.trim() !== workspace.name}
        onConfirm={async () => {
          const next = await deleteWorkspace.mutateAsync(workspace.id);
          toast.success(`Deleted ${workspace.name}`);
          void goTo(next);
        }}
      >
        <Field
          id="confirm-workspace-name"
          labelClassName="font-normal"
          label={
            <>
              Type <strong className="font-semibold">{workspace.name}</strong> to confirm
            </>
          }
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
