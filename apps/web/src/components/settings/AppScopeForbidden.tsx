export function AppScopeForbidden() {
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-neutral-900 mb-2">App Settings</h2>
      <p className="text-sm text-neutral-600">App settings are available only to app managers.</p>
    </div>
  );
}
