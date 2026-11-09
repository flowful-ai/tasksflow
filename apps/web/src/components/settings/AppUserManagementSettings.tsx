import { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { AppRole } from '@flowtask/shared';
import type { AppManagedUser } from '../../api/agents';
import { useAppUsers, useUpdateAppUserRole } from '../../hooks/queries';
import { ErrorState, toast } from '../ui';

interface AppUserManagementSettingsProps {
  isAppManager: boolean;
}

const DEFAULT_LIMIT = 50;

function roleLabel(role: AppRole): string {
  return role === 'app_manager' ? 'App Manager' : 'User';
}

export function AppUserManagementSettings({ isAppManager }: AppUserManagementSettingsProps) {
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const { data, isLoading, error, refetch } = useAppUsers(
    { search: appliedSearch || undefined, limit: DEFAULT_LIMIT, offset: 0 },
    isAppManager
  );
  const updateRole = useUpdateAppUserRole();
  const total = data?.total ?? 0;

  const sortedUsers = useMemo(
    () =>
      [...(data?.users ?? [])].sort((a, b) => {
        if (a.appRole !== b.appRole) return a.appRole === 'app_manager' ? -1 : 1;
        return a.email.localeCompare(b.email);
      }),
    [data?.users]
  );

  const handleRoleToggle = (managedUser: AppManagedUser) => {
    const nextRole: AppRole = managedUser.appRole === 'app_manager' ? 'user' : 'app_manager';
    updateRole.mutate(
      { userId: managedUser.id, appRole: nextRole },
      { onSuccess: () => toast.success(`Updated ${managedUser.email} to ${roleLabel(nextRole)}.`) }
    );
  };

  if (!isAppManager) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-2">User Management</h2>
        <p className="text-sm text-neutral-600">
          Only app managers can manage users at the application level.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">App Users</h2>
          <p className="text-sm text-neutral-600 mt-1">Manage app-wide access roles for all users.</p>
        </div>
        <div className="text-sm text-neutral-500">
          {total} total user{total === 1 ? '' : 's'}
        </div>
      </div>

      <form
        role="search"
        className="flex flex-col sm:flex-row gap-2 mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedSearch(searchInput.trim());
        }}
      >
        <label htmlFor="app-user-search" className="sr-only">
          Search users
        </label>
        <input
          id="app-user-search"
          className="input flex-1"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by email or name"
        />
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setSearchInput('');
            setAppliedSearch('');
          }}
          disabled={!searchInput && !appliedSearch}
        >
          Clear
        </button>
      </form>

      {error ? (
        <ErrorState error={error} resource="user list" onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-2" aria-busy>
          <div className="h-12 bg-neutral-100 rounded animate-pulse" />
          <div className="h-12 bg-neutral-100 rounded animate-pulse" />
          <div className="h-12 bg-neutral-100 rounded animate-pulse" />
        </div>
      ) : (
        <ul className="border border-neutral-200 rounded-lg divide-y divide-neutral-100">
          {sortedUsers.length === 0 && (
            <li className="p-4 text-sm text-neutral-500">No users found.</li>
          )}

          {sortedUsers.map((managedUser) => {
            const isUpdating =
              updateRole.isPending && updateRole.variables?.userId === managedUser.id;
            const isAppManagerRole = managedUser.appRole === 'app_manager';
            return (
              <li key={managedUser.id} className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-900 truncate">
                    {managedUser.name || managedUser.email}
                  </p>
                  <p className="text-sm text-neutral-500 truncate">{managedUser.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={clsx(
                      'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
                      isAppManagerRole ? 'bg-blue-100 text-blue-700' : 'bg-neutral-100 text-neutral-700'
                    )}
                  >
                    {roleLabel(managedUser.appRole)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary text-sm"
                    disabled={isUpdating}
                    onClick={() => handleRoleToggle(managedUser)}
                  >
                    {isUpdating
                      ? 'Updating...'
                      : isAppManagerRole
                        ? 'Revoke App Manager'
                        : 'Make App Manager'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
