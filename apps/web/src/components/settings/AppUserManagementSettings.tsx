import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { AppRole } from '@flowtask/shared';
import { appAdminApi, type AppManagedUser } from '../../api/client';

interface AppUserManagementSettingsProps {
  isAppManager: boolean;
}

const DEFAULT_LIMIT = 50;

function roleLabel(role: AppRole): string {
  return role === 'app_manager' ? 'App Manager' : 'User';
}

export function AppUserManagementSettings({ isAppManager }: AppUserManagementSettingsProps) {
  const [users, setUsers] = useState<AppManagedUser[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingUserId, setIsUpdatingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const sortedUsers = useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.appRole !== b.appRole) {
          return a.appRole === 'app_manager' ? -1 : 1;
        }
        return a.email.localeCompare(b.email);
      }),
    [users]
  );

  const loadUsers = async (search = appliedSearch) => {
    if (!isAppManager) {
      setUsers([]);
      setTotal(0);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await appAdminApi.listUsers({
        search: search || undefined,
        limit: DEFAULT_LIMIT,
        offset: 0,
      });

      setUsers(response.data.users);
      setTotal(response.data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers(appliedSearch);
  }, [appliedSearch, isAppManager]);

  const applySearch = () => {
    setAppliedSearch(searchInput.trim());
  };

  const clearSearch = () => {
    setSearchInput('');
    setAppliedSearch('');
  };

  const handleRoleToggle = async (managedUser: AppManagedUser) => {
    const nextRole: AppRole = managedUser.appRole === 'app_manager' ? 'user' : 'app_manager';

    setIsUpdatingUserId(managedUser.id);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await appAdminApi.updateRole(managedUser.id, nextRole);
      setUsers((prev) => prev.map((user) => (user.id === managedUser.id ? response.data : user)));
      setSuccessMessage(`Updated ${managedUser.email} to ${roleLabel(nextRole)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user role');
    } finally {
      setIsUpdatingUserId(null);
    }
  };

  if (!isAppManager) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">User Management</h2>
        <p className="text-sm text-gray-600">
          Only app managers can manage users at the application level.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">App Users</h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage app-wide access roles for all users.
          </p>
        </div>
        <div className="text-sm text-gray-500">
          {total} total user{total === 1 ? '' : 's'}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          className="input flex-1"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              applySearch();
            }
          }}
          placeholder="Search by email or name"
        />
        <button className="btn btn-secondary" onClick={applySearch}>
          Search
        </button>
        <button className="btn btn-secondary" onClick={clearSearch} disabled={!searchInput && !appliedSearch}>
          Clear
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 rounded-lg">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="mb-4 p-3 text-sm text-green-700 bg-green-50 rounded-lg">
          {successMessage}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          <div className="h-12 bg-gray-100 rounded animate-pulse" />
          <div className="h-12 bg-gray-100 rounded animate-pulse" />
          <div className="h-12 bg-gray-100 rounded animate-pulse" />
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
          {sortedUsers.length === 0 && (
            <div className="p-4 text-sm text-gray-500">No users found.</div>
          )}

          {sortedUsers.map((managedUser) => {
            const isUpdating = isUpdatingUserId === managedUser.id;
            const isAppManagerRole = managedUser.appRole === 'app_manager';

            return (
              <div key={managedUser.id} className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{managedUser.name || managedUser.email}</p>
                  <p className="text-sm text-gray-500 truncate">{managedUser.email}</p>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={clsx(
                      'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
                      isAppManagerRole ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                    )}
                  >
                    {roleLabel(managedUser.appRole)}
                  </span>

                  <button
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
