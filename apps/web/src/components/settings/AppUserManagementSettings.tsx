import { useMemo, useState } from 'react';
import type { AppRole } from '@flowtask/shared';
import type { AppManagedUser } from '../../api/agents';
import { useAppUsers, useUpdateAppUserRole } from '../../hooks/queries';
import { Badge, Button, Card, ErrorState, Input, toast } from '../ui';

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
      <Card title="User Management">
        <p className="text-sm text-neutral-600">
          Only app managers can manage users at the application level.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="App Users"
      description="Manage app-wide access roles for all users."
      actions={
        <span className="text-sm text-neutral-500">
          {total} total user{total === 1 ? '' : 's'}
        </span>
      }
    >
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
        <Input
          id="app-user-search"
          className="flex-1"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by email or name"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setSearchInput('');
            setAppliedSearch('');
          }}
          disabled={!searchInput && !appliedSearch}
        >
          Clear
        </Button>
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
                  <Badge shape="pill" tone={isAppManagerRole ? 'info' : 'neutral'}>
                    {roleLabel(managedUser.appRole)}
                  </Badge>
                  <Button
                    variant="secondary"
                    disabled={isUpdating}
                    onClick={() => handleRoleToggle(managedUser)}
                  >
                    {isUpdating
                      ? 'Updating...'
                      : isAppManagerRole
                        ? 'Revoke App Manager'
                        : 'Make App Manager'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
