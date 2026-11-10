import type { AppRole } from '@flowtask/shared';
import { Card, Panel } from '../ui';

interface AppOverviewSettingsProps {
  appRole: AppRole | null;
}

export function AppOverviewSettings({ appRole }: AppOverviewSettingsProps) {
  const isAppManager = appRole === 'app_manager';

  return (
    <Card
      title="App Settings Overview"
      description="App settings apply to the entire FlowTask application, not just one workspace."
    >
      <Panel>
        <p className="text-sm text-neutral-500">Current app role</p>
        <p className="mt-1 text-base font-medium text-neutral-900">
          {isAppManager ? 'App Manager' : 'User'}
        </p>
      </Panel>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-neutral-900 mb-2">Current capabilities</h3>
        <ul className="text-sm text-neutral-600 space-y-1">
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
    </Card>
  );
}
