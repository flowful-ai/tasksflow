import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';

export interface NoWorkspaceStateProps {
  email?: string | null;
  onSignOut: () => void;
}

/**
 * Shown instead of a page when the signed-in user belongs to no workspace.
 * Every page needs a workspace, so without this they wait on one forever.
 */
export function NoWorkspaceState({ email, onSignOut }: NoWorkspaceStateProps) {
  return (
    <EmptyState
      icon={<Building2 aria-hidden className="h-6 w-6" />}
      title="You're not in a workspace yet"
      body={
        <>
          {email ? (
            <>
              Signed in as <span className="font-medium text-gray-900">{email}</span>.{' '}
            </>
          ) : null}
          Ask a workspace admin to invite this email, or create your own workspace. If you usually
          sign in with another account, sign out and use that one.
        </>
      }
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link to="/settings/workspace/new" className="btn btn-primary">
            Create a workspace
          </Link>
          <button type="button" className="btn btn-secondary" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      }
    />
  );
}
