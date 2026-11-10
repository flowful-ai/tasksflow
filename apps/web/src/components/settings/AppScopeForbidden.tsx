import { Card } from '../ui';

export function AppScopeForbidden() {
  return (
    <Card title="App Settings">
      <p className="text-sm text-neutral-600">App settings are available only to app managers.</p>
    </Card>
  );
}
