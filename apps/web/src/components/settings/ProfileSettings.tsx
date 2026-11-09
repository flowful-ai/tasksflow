import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, Monitor, Smartphone } from 'lucide-react';
import { ApiError } from '../../api/http';
import type { AuthSession } from '../../api/auth';
import {
  useRevokeOtherSessions,
  useRevokeSession,
  useSessions,
  useUpdateProfileName,
} from '../../hooks/queries';
import {
  MAX_NAME_LENGTH,
  avatarUrlOf,
  describeUserAgent,
  initials,
  validateName,
} from '../../lib/account';
import { formatDateTime, relativeTime } from '../../lib/time';
import { useAuthStore } from '../../stores/auth';
import { ConfirmDialog, ErrorState, Spinner, toast } from '../ui';

export function ProfileSettings() {
  return (
    <div className="space-y-6">
      <ProfileCard />
      <SessionsCard />
    </div>
  );
}

function ProfileCard() {
  const user = useAuthStore((s) => s.user);
  const updateName = useUpdateProfileName();
  const [name, setName] = useState(user?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const avatarUrl = avatarUrlOf(user);

  useEffect(() => {
    setName(user?.name ?? '');
  }, [user?.name]);

  const dirty = name.trim() !== (user?.name ?? '');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = validateName(name);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    updateName.mutate(result.value, { onSuccess: () => toast.success('Name updated') });
  };

  return (
    <section aria-labelledby="profile-heading" className="card p-6">
      <div className="mb-6 flex items-center gap-4">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div
            aria-hidden
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-600 text-xl font-semibold text-white"
          >
            {initials(user?.name, user?.email)}
          </div>
        )}
        <div className="min-w-0">
          <h2 id="profile-heading" className="text-lg font-semibold text-gray-900">
            Profile
          </h2>
          <p className="text-sm text-gray-500">
            Your avatar comes from the account you signed in with.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="profile-name" className="mb-1 block text-sm font-medium text-gray-700">
            Display name
          </label>
          <input
            id="profile-name"
            type="text"
            className="input"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="name"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'profile-name-error' : undefined}
          />
          {error && (
            <p id="profile-name-error" role="alert" className="mt-1 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="profile-email" className="mb-1 block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="profile-email"
            type="email"
            className="input bg-gray-50 text-gray-500"
            value={user?.email ?? ''}
            readOnly
            aria-describedby="profile-email-hint"
          />
          <p id="profile-email-hint" className="mt-1 text-xs text-gray-500">
            Your email comes from your sign-in provider and can't be changed here. Manage linked
            accounts in{' '}
            <Link to="/settings/user/integrations" className="text-primary-600 hover:underline">
              Integrations
            </Link>
            .
          </p>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={updateName.isPending || !dirty}
          >
            {updateName.isPending ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </form>
    </section>
  );
}

function isMobile(userAgent: string | null | undefined): boolean {
  return /iPhone|iPad|iPod|Android|Mobile/.test(userAgent ?? '');
}

function SessionsCard() {
  const { data, error, isLoading, refetch } = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const logout = useAuthStore((s) => s.logout);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const sessions = data?.sessions ?? [];
  const others = sessions.filter((s) => s.id !== data?.currentId);
  const notFresh = error instanceof ApiError && error.code === 'SESSION_NOT_FRESH';

  const handleRevoke = (session: AuthSession) => {
    setRevoking(session.id);
    revoke.mutate(session.token, {
      onSuccess: () => toast.success(`Signed out ${describeUserAgent(session.userAgent)}`),
      onSettled: () => setRevoking(null),
    });
  };

  return (
    <section aria-labelledby="sessions-heading" className="card p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="sessions-heading" className="text-lg font-semibold text-gray-900">
            Active sessions
          </h2>
          <p className="text-sm text-gray-500">
            Devices signed in to your account. Sign out any you don't recognise.
          </p>
        </div>
        {others.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary shrink-0"
            onClick={() => setConfirmOthers(true)}
          >
            <LogOut aria-hidden className="mr-2 h-4 w-4" />
            Sign out of all other sessions
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner label="Loading sessions" />
        </div>
      ) : notFresh ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <p>
            For your security, the session list is only shown within a day of signing in. Sign in
            again to review your sessions.
          </p>
          <button type="button" className="btn btn-secondary mt-3" onClick={() => void logout()}>
            Sign out and sign in again
          </button>
        </div>
      ) : error ? (
        <ErrorState error={error} resource="session list" onRetry={() => void refetch()} />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {sessions.map((session) => {
            const current = session.id === data?.currentId;
            const Icon = isMobile(session.userAgent) ? Smartphone : Monitor;
            return (
              <li key={session.id} className="flex items-center gap-3 p-4">
                <Icon aria-hidden className="h-5 w-5 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
                    {describeUserAgent(session.userAgent)}
                    {current && (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {session.ipAddress ? `${session.ipAddress} · ` : ''}
                    <span title={formatDateTime(session.updatedAt)}>
                      Last active {relativeTime(session.updatedAt)}
                    </span>
                    {' · '}Signed in {formatDateTime(session.createdAt)}
                  </p>
                </div>
                {!current && (
                  <button
                    type="button"
                    className="btn btn-secondary shrink-0"
                    disabled={revoking === session.id}
                    aria-label={`Sign out ${describeUserAgent(session.userAgent)}, last active ${relativeTime(session.updatedAt)}`}
                    onClick={() => handleRevoke(session)}
                  >
                    {revoking === session.id ? 'Signing out...' : 'Sign out'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title="Sign out of all other sessions?"
        description={`${others.length} other ${others.length === 1 ? 'session' : 'sessions'} will be signed out. This browser stays signed in.`}
        confirmLabel="Sign out others"
        variant="danger"
        onConfirm={async () => {
          await revokeOthers.mutateAsync();
          toast.success('Signed out of all other sessions');
        }}
      />
    </section>
  );
}
