import { useAuthStore } from '../../stores/auth';

export function ProfileSettings() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Profile</h2>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-gray-500">Name</dt>
        <dd className="text-gray-900">{user?.name || '—'}</dd>
        <dt className="text-gray-500">Email</dt>
        <dd className="text-gray-900">{user?.email}</dd>
      </dl>
      <p className="mt-4 text-sm text-gray-500">Your name and avatar come from the account you signed in with.</p>
    </div>
  );
}
