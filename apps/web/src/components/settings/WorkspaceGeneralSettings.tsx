import { Link } from 'react-router-dom';
import { useCurrentWorkspace, useWorkspaceRole } from '../../hooks/queries';

export function WorkspaceGeneralSettings() {
  const { workspace } = useCurrentWorkspace();
  const { data: role } = useWorkspaceRole(workspace?.id);
  if (!workspace) {
    return (
      <div className="card p-6">
        <p className="text-gray-600">Select a workspace first.</p>
      </div>
    );
  }
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Workspace</h2>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-gray-500">Name</dt>
        <dd className="text-gray-900">{workspace.name}</dd>
        <dt className="text-gray-500">Slug</dt>
        <dd className="font-mono text-gray-900">{workspace.slug}</dd>
        <dt className="text-gray-500">Members</dt>
        <dd className="text-gray-900">{workspace.members.length}</dd>
        <dt className="text-gray-500">Your role</dt>
        <dd className="text-gray-900 capitalize">{role ?? '—'}</dd>
      </dl>
      <p className="mt-4 text-sm text-gray-500">
        The owner can hand the workspace over in{' '}
        <Link to="/settings/workspace/members" className="text-primary-600 hover:underline">
          Members
        </Link>
        .
      </p>
    </div>
  );
}
