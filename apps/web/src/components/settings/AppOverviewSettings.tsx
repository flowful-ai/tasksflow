import type { AppRole } from '@flowtask/shared';

interface AppOverviewSettingsProps {
  appRole: AppRole | null;
}

export function AppOverviewSettings({ appRole }: AppOverviewSettingsProps) {
  const isAppManager = appRole === 'app_manager';

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">App Settings Overview</h2>
      <p className="text-sm text-gray-600 mb-6">
        App settings apply to the entire TasksFlow application, not just one workspace.
      </p>

      <div className="rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-gray-500">Current app role</p>
        <p className="mt-1 text-base font-medium text-gray-900">
          {isAppManager ? 'App Manager' : 'User'}
        </p>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Current capabilities</h3>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>View app-level settings scope</li>
          {isAppManager ? (
            <>
              <li>List all users across the application</li>
              <li>Grant or revoke the app manager role</li>
            </>
          ) : (
            <li>No app-wide administration permissions</li>
          )}
        </ul>
      </div>
    </div>
  );
}
