import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../../api/auth';
import { useLinkedAccounts, useUnlinkAccount } from '../../hooks/queries';
import { Button, Card, ConfirmDialog, ErrorState, Panel, toast } from '../ui';

const GITHUB_PATH =
  'M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z';

/** User settings → Integrations: the user's linked GitHub account. */
export function IntegrationSettings() {
  const githubEnabled = Boolean(import.meta.env.VITE_GITHUB_CLIENT_ID);
  const { data: accounts, isLoading, error, refetch } = useLinkedAccounts();
  const unlink = useUnlinkAccount();
  const [isConnecting, setIsConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const githubAccount = accounts?.find((account) => account.providerId === 'github');

  const handleConnectGithub = async () => {
    setIsConnecting(true);
    try {
      const response = await authApi.linkSocial({
        provider: 'github',
        callbackURL: `${window.location.origin}/settings/user/integrations`,
        scopes: ['repo', 'read:user', 'user:email'],
      });
      if (response.redirect && response.url) {
        window.location.href = response.url;
        return;
      }
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect GitHub');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Card title="Integrations" description="Connect your own accounts to TasksFlow.">
      {error ? (
        <ErrorState
          error={error}
          resource="list of linked accounts"
          onRetry={() => void refetch()}
        />
      ) : (
        <ul className="mt-6 space-y-4">
          <li>
            <Panel className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div
                  aria-hidden
                  className="w-10 h-10 bg-neutral-900 rounded-lg flex items-center justify-center"
                >
                  <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d={GITHUB_PATH} />
                  </svg>
                </div>
                <div>
                  <h3 className="font-medium text-neutral-900">GitHub</h3>
                  <p className="text-sm text-neutral-500">Sync issues and pull requests</p>
                  <p className="text-xs mt-1" role="status">
                    {isLoading ? (
                      <span className="text-neutral-500">Checking connection…</span>
                    ) : githubAccount ? (
                      <span className="text-green-700">Connected</span>
                    ) : githubEnabled ? (
                      <span className="text-neutral-500">Not connected</span>
                    ) : (
                      <span className="text-amber-700">Not configured on this server</span>
                    )}
                  </p>
                </div>
              </div>
              {githubAccount ? (
                <Button variant="secondary" onClick={() => setConfirmDisconnect(true)}>
                  Disconnect
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => void handleConnectGithub()}
                  disabled={isConnecting || !githubEnabled}
                >
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </Button>
              )}
            </Panel>
          </li>
          <li>
            <Panel className="text-sm text-neutral-600">
              <h3 className="font-medium text-neutral-900">Slack</h3>
              Slack notifications are configured per project, in{' '}
              <Link to="/projects" className="text-primary-600 hover:underline">
                project settings → Slack
              </Link>
              . Workspace-wide events can also be sent anywhere with{' '}
              <Link to="/settings/workspace/webhooks" className="text-primary-600 hover:underline">
                outgoing webhooks
              </Link>
              .
            </Panel>
          </li>
        </ul>
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect GitHub?"
        description="TasksFlow will no longer act on GitHub with your account. Project integrations installed as a GitHub App keep working."
        confirmLabel="Disconnect"
        variant="danger"
        onConfirm={async () => {
          if (!githubAccount) return;
          await unlink.mutateAsync({ providerId: 'github', accountId: githubAccount.accountId });
          toast.success('GitHub disconnected');
        }}
      />
    </Card>
  );
}
