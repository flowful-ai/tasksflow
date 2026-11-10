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
import { MAX_NAME_LENGTH, avatarUrlOf, describeUserAgent, validateName } from '../../lib/account';
import { formatDateTime, relativeTime } from '../../lib/time';
import { useAuthStore } from '../../stores/auth';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Field,
  Input,
  Panel,
  Spinner,
  toast,
} from '../ui';

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
    <Card as="section" aria-labelledby="profile-heading">
      <div className="mb-6 flex items-center gap-4">
        <Avatar src={avatarUrl} name={user?.name} email={user?.email} tone="brand" size="2xl" />
        <div className="min-w-0">
          <h2 id="profile-heading" className="text-lg font-semibold text-neutral-900">
            Profile
          </h2>
          <p className="text-sm text-neutral-500">
            Your avatar comes from the account you signed in with.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Display name" id="profile-name" error={error}>
          <Input
            value={name}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="name"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field
          label="Email"
          id="profile-email"
          hint={
            <>
              Your email comes from your sign-in provider and can&apos;t be changed here. Manage
              linked accounts in{' '}
              <Link to="/settings/user/integrations" className="text-primary-600 hover:underline">
                Integrations
              </Link>
              .
            </>
          }
        >
          <Input type="email" value={user?.email ?? ''} readOnly />
        </Field>

        <div className="pt-2">
          <Button type="submit" disabled={updateName.isPending || !dirty}>
            {updateName.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Card>
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
    <Card
      title="Active sessions"
      description="Devices signed in to your account. Sign out any you don't recognise."
      actions={
        others.length > 0 && (
          <Button
            variant="secondary"
            leadingIcon={<LogOut />}
            onClick={() => setConfirmOthers(true)}
          >
            Sign out of all other sessions
          </Button>
        )
      }
    >
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner label="Loading sessions" />
        </div>
      ) : notFresh ? (
        <Panel tone="muted" className="text-sm text-neutral-700">
          <p>
            For your security, the session list is only shown within a day of signing in. Sign in
            again to review your sessions.
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => void logout()}>
            Sign out and sign in again
          </Button>
        </Panel>
      ) : error ? (
        <ErrorState error={error} resource="session list" onRetry={() => void refetch()} />
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {sessions.map((session) => {
            const current = session.id === data?.currentId;
            const Icon = isMobile(session.userAgent) ? Smartphone : Monitor;
            return (
              <li key={session.id} className="flex items-center gap-3 p-4">
                <Icon aria-hidden className="h-5 w-5 shrink-0 text-neutral-400" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-900">
                    {describeUserAgent(session.userAgent)}
                    {current && (
                      <Badge tone="success" shape="pill">
                        This device
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-xs text-neutral-500">
                    {session.ipAddress ? `${session.ipAddress} · ` : ''}
                    <span title={formatDateTime(session.updatedAt)}>
                      Last active {relativeTime(session.updatedAt)}
                    </span>
                    {' · '}Signed in {formatDateTime(session.createdAt)}
                  </p>
                </div>
                {!current && (
                  <Button
                    variant="secondary"
                    className="shrink-0"
                    disabled={revoking === session.id}
                    aria-label={`Sign out ${describeUserAgent(session.userAgent)}, last active ${relativeTime(session.updatedAt)}`}
                    onClick={() => handleRevoke(session)}
                  >
                    {revoking === session.id ? 'Signing out...' : 'Sign out'}
                  </Button>
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
    </Card>
  );
}
