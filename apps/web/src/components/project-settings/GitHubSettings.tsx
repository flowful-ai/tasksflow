import { useState, useEffect } from 'react';
import {
  ExternalLink,
  Trash2,
  RefreshCw,
  Link2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
} from 'lucide-react';
import { githubApi, type GitHubRepository, type LinkedRepository } from '../../api/integrations';
import {
  useGitHubInstallations,
  useGitHubIntegration,
  useGitHubMutations,
  useGitHubRepos,
} from '../../hooks/queries';
import {
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  PageSpinner,
  Spinner,
  toast,
} from '../ui';

// GitHub icon component (since lucide-react deprecated Github)
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

interface GitHubSettingsProps {
  projectId: string;
}

const GITHUB_APP_SLUG = import.meta.env.VITE_GITHUB_APP_SLUG;

const INSTALL_ERROR_MESSAGES: Record<string, string> = {
  not_signed_in: 'Sign in again, then restart the GitHub installation.',
  installation_requested:
    'Installation was requested; an organization owner must approve it on GitHub.',
  authorization_required:
    'GitHub did not return an authorization code. Enable "Request user authorization (OAuth) during installation" on the GitHub App.',
  missing_installation: 'GitHub did not return an installation id.',
  invalid_state: 'The install link expired or was already used. Please start again.',
  session_mismatch: 'The install was started from a different session. Please start again.',
  forbidden: 'You need admin access to this project to install GitHub.',
  not_configured:
    'GitHub App OAuth is not configured on the server (GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET).',
  verification_failed: 'Could not verify that your GitHub account can access this installation.',
};

export function GitHubSettings({ projectId }: GitHubSettingsProps) {
  const isGitHubAppConfigured = !!GITHUB_APP_SLUG;
  const [showRepoSelector, setShowRepoSelector] = useState(false);
  const [selectedInstallationId, setSelectedInstallationId] = useState<number | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<LinkedRepository | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repoFilter, setRepoFilter] = useState('');

  const {
    data: integration,
    isLoading: integrationLoading,
    refetch: refetchIntegration,
  } = useGitHubIntegration(projectId);
  // The user's GitHub App installations (to know whether they can link repos)
  const { data: userInstallations, refetch: refetchInstallations } = useGitHubInstallations();
  const {
    link: linkMutation,
    unlink: unlinkMutation,
    sync: syncMutation,
  } = useGitHubMutations(projectId);

  // After the server-side install callback, GitHub lands back here with either
  // github_installation_id (verified and saved) or github_error.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifiedInstallationId = params.get('github_installation_id');
    const installError = params.get('github_error');
    const legacyInstallationId = params.get('installation_id');

    if (!verifiedInstallationId && !installError && !legacyInstallationId) return;
    window.history.replaceState({}, '', window.location.pathname);

    if (verifiedInstallationId) {
      const installId = parseInt(verifiedInstallationId, 10);
      if (!Number.isNaN(installId)) {
        setSelectedInstallationId(installId);
        setShowRepoSelector(true);
      }
      void refetchInstallations();
      void refetchIntegration();
    } else if (installError) {
      setError(INSTALL_ERROR_MESSAGES[installError] ?? 'GitHub installation failed.');
    } else {
      // A bare installation_id can't be trusted without the OAuth proof.
      setError(INSTALL_ERROR_MESSAGES.authorization_required);
    }
  }, [refetchIntegration, refetchInstallations]);

  const { data: availableRepos, isLoading: reposLoading } = useGitHubRepos(
    showRepoSelector ? selectedInstallationId : null
  );

  const normalizedRepoFilter = repoFilter.trim().toLowerCase();
  const filteredRepos = availableRepos?.filter((repo) => {
    if (!normalizedRepoFilter) return true;
    return repo.fullName.toLowerCase().includes(normalizedRepoFilter);
  });

  const linkRepo = (repo: GitHubRepository) => {
    if (selectedInstallationId === null) return;
    linkMutation.mutate(
      { installationId: selectedInstallationId, owner: repo.owner, repo: repo.name },
      {
        onSuccess: () => {
          setShowRepoSelector(false);
          setError(null);
          toast.success(`Linked ${repo.fullName}`);
        },
      }
    );
  };

  const syncRepo = (repo: LinkedRepository) =>
    syncMutation.mutate(
      { owner: repo.owner, repo: repo.repo },
      {
        onSuccess: (result) =>
          toast.success(
            `Synced ${repo.owner}/${repo.repo}: ${result.created} created, ${result.updated} updated`,
            {
              description: result.errors.length > 0 ? `${result.errors.length} errors` : undefined,
            }
          ),
      }
    );

  const chooseInstallation = (installationId: number) => {
    setSelectedInstallationId(installationId);
    setShowRepoSelector(true);
  };

  const handleInstallGitHubApp = async () => {
    try {
      // The server issues a single-use state nonce bound to this session; GitHub
      // passes it back to the callback together with the OAuth code.
      const { state, installUrl } = await githubApi.startInstall(projectId);
      window.location.href =
        installUrl ??
        `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start GitHub installation');
    }
  };

  const hasLinkedRepos = integration?.repositories && integration.repositories.length > 0;

  if (integrationLoading) {
    return (
      <div className="card p-6">
        <PageSpinner className="h-32" label="Loading GitHub integration" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="card p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-gray-900 rounded-lg flex items-center justify-center flex-shrink-0">
            <GithubIcon className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900">GitHub Integration</h2>
            <p className="text-sm text-gray-500 mt-1">
              Connect GitHub repositories to sync issues and pull requests with your project tasks.
              Changes sync both ways - updates in TasksFlow reflect in GitHub and vice versa.
            </p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 p-3 text-sm text-red-600 bg-red-50 rounded-lg flex items-start gap-2"
          >
            <AlertCircle aria-hidden className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!hasLinkedRepos && !showRepoSelector && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            {!isGitHubAppConfigured ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-amber-900 mb-2">
                  GitHub App Not Configured
                </h3>
                <p className="text-sm text-amber-800 mb-3">
                  To enable GitHub integration, you need to create a GitHub App and configure it:
                </p>
                <ol className="text-sm text-amber-800 list-decimal list-inside space-y-1 mb-3">
                  <li>Go to GitHub Settings → Developer settings → GitHub Apps</li>
                  <li>
                    Create a new GitHub App with these permissions:
                    <ul className="ml-5 mt-1 list-disc">
                      <li>Issues: Read & Write</li>
                      <li>Pull requests: Read</li>
                      <li>Contents: Read (for commit references)</li>
                    </ul>
                  </li>
                  <li>
                    Set the callback URL to <code>/api/github/callback</code> on your app URL and
                    enable &quot;Request user authorization (OAuth) during installation&quot;
                  </li>
                  <li>Generate a private key</li>
                  <li>
                    Set these environment variables:
                    <ul className="ml-5 mt-1 list-disc font-mono text-xs">
                      <li>GITHUB_APP_ID</li>
                      <li>GITHUB_APP_PRIVATE_KEY</li>
                      <li>GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET</li>
                      <li>GITHUB_WEBHOOK_SECRET</li>
                      <li>VITE_GITHUB_APP_SLUG (your app's URL slug)</li>
                    </ul>
                  </li>
                </ol>
                <a
                  href="https://github.com/settings/apps/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-amber-700 hover:text-amber-900 underline"
                >
                  Create GitHub App →
                </a>
              </div>
            ) : userInstallations && userInstallations.length > 0 ? (
              // User has GitHub installations - show Link Repository
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 aria-hidden className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-sm font-medium text-gray-900 mb-1">GitHub App Installed</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Link a repository to start syncing issues.
                </p>
                {userInstallations.length === 1 ? (
                  <button
                    type="button"
                    onClick={() => chooseInstallation(userInstallations[0].installationId)}
                    className="btn btn-primary inline-flex items-center"
                  >
                    <Link2 aria-hidden className="w-4 h-4 mr-2" />
                    Link Repository
                    {userInstallations[0]?.accountLogin && (
                      <span className="ml-1 text-primary-200">
                        ({userInstallations[0].accountLogin})
                      </span>
                    )}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500 mb-2">Choose an installation:</p>
                    {userInstallations.map((inst) => (
                      <button
                        type="button"
                        key={inst.installationId}
                        onClick={() => chooseInstallation(inst.installationId)}
                        className="btn btn-primary inline-flex items-center mr-2"
                      >
                        <Link2 aria-hidden className="w-4 h-4 mr-2" />
                        {inst.accountLogin || `Installation #${inst.installationId}`}
                        {inst.accountType && (
                          <span className="ml-1 text-xs text-primary-200">
                            ({inst.accountType})
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => void handleInstallGitHubApp()}
                    className="text-sm text-gray-500 hover:text-gray-700 underline"
                  >
                    Install on a different account/org
                  </button>
                </div>
              </div>
            ) : (
              // No installations at all - show Install button
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Link2 aria-hidden className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-sm font-medium text-gray-900 mb-1">No repositories linked</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Install the TasksFlow GitHub App to start syncing issues.
                </p>
                <button
                  type="button"
                  onClick={() => void handleInstallGitHubApp()}
                  className="btn btn-primary inline-flex items-center"
                >
                  <GithubIcon className="w-4 h-4 mr-2" />
                  Install GitHub App
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Repository Selector */}
      {showRepoSelector && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Select Repository to Link</h3>
            <button
              type="button"
              onClick={() => {
                setShowRepoSelector(false);
                setSelectedInstallationId(null);
              }}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>

          {reposLoading ? (
            <PageSpinner className="h-32" label="Loading repositories" />
          ) : availableRepos?.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No repositories found in this installation.</p>
              <button
                type="button"
                onClick={() => void handleInstallGitHubApp()}
                className="mt-2 text-primary-600 hover:underline text-sm"
              >
                Configure GitHub App permissions
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <label htmlFor="github-repo-filter" className="sr-only">
                Filter repositories
              </label>
              <input
                id="github-repo-filter"
                type="text"
                value={repoFilter}
                onChange={(event) => setRepoFilter(event.target.value)}
                placeholder="Filter repositories..."
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              {filteredRepos && filteredRepos.length === 0 ? (
                <div className="text-center py-6 text-sm text-gray-500">
                  No repositories match "{repoFilter.trim()}".
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {filteredRepos?.map((repo) => {
                    const isAlreadyLinked = integration?.repositories?.some(
                      (r) => r.owner === repo.owner && r.repo === repo.name
                    );
                    return (
                      <button
                        key={repo.id}
                        type="button"
                        onClick={() => !isAlreadyLinked && linkRepo(repo)}
                        disabled={isAlreadyLinked || linkMutation.isPending}
                        className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors ${
                          isAlreadyLinked
                            ? 'bg-gray-50 border-gray-200 cursor-not-allowed'
                            : 'border-gray-200 hover:border-primary-300 hover:bg-primary-50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <GithubIcon className="w-5 h-5 text-gray-600" />
                          <span className="font-medium text-gray-900">{repo.fullName}</span>
                        </div>
                        {isAlreadyLinked ? (
                          <span className="text-xs text-gray-500">Already linked</span>
                        ) : linkMutation.isPending ? (
                          <Spinner size="sm" label="Linking" />
                        ) : (
                          <span className="text-sm text-primary-600">Link</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Linked Repositories */}
      {hasLinkedRepos && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Linked Repositories</h3>
            {isGitHubAppConfigured &&
              userInstallations &&
              userInstallations.length > 0 &&
              (userInstallations.length === 1 ? (
                <button
                  type="button"
                  onClick={() => chooseInstallation(userInstallations[0].installationId)}
                  className="text-sm text-primary-600 hover:underline flex items-center gap-1"
                >
                  <Link2 aria-hidden className="w-3 h-3" />
                  Add Repository
                </button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="text-sm text-primary-600 hover:underline flex items-center gap-1"
                    >
                      <Link2 aria-hidden className="w-3 h-3" />
                      Add Repository
                      <ChevronDown aria-hidden className="w-3 h-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {userInstallations.map((inst) => (
                      <DropdownMenuItem
                        key={inst.installationId}
                        onSelect={() => chooseInstallation(inst.installationId)}
                      >
                        {inst.accountLogin || `Installation #${inst.installationId}`}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ))}
          </div>

          <div className="space-y-3">
            {integration?.repositories?.map((repo) => (
              <div
                key={`${repo.owner}/${repo.repo}`}
                className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <GithubIcon className="w-5 h-5 text-gray-600" />
                  <div>
                    <a
                      href={`https://github.com/${repo.owner}/${repo.repo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-gray-900 hover:text-primary-600 flex items-center gap-1"
                    >
                      {repo.owner}/{repo.repo}
                      <ExternalLink aria-hidden className="w-3 h-3" />
                      <span className="sr-only">(opens GitHub)</span>
                    </a>
                    <div className="flex items-center gap-2 mt-0.5">
                      {repo.syncStatus === 'synced' && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <CheckCircle2 aria-hidden className="w-3 h-3" />
                          Synced
                        </span>
                      )}
                      {repo.syncStatus === 'syncing' && (
                        <span className="text-xs text-blue-600 flex items-center gap-1">
                          <RefreshCw aria-hidden className="w-3 h-3 animate-spin" />
                          Syncing...
                        </span>
                      )}
                      {repo.syncStatus === 'error' && (
                        <span
                          className="text-xs text-red-600 flex items-center gap-1"
                          title={repo.syncError || undefined}
                        >
                          <AlertCircle aria-hidden className="w-3 h-3" />
                          Sync error
                        </span>
                      )}
                      {repo.lastSyncAt && (
                        <span className="text-xs text-gray-500">
                          Last synced: {new Date(repo.lastSyncAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {repo.syncStatus === 'error' && (
                      <div className="mt-1 text-xs text-red-600">
                        {repo.syncError || 'Sync failed with an unknown error.'}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <IconButton
                    label={`Sync ${repo.owner}/${repo.repo} now`}
                    variant="subtle"
                    size="md"
                    onClick={() => syncRepo(repo)}
                    disabled={syncMutation.isPending || repo.syncStatus === 'syncing'}
                    icon={
                      <RefreshCw className={syncMutation.isPending ? 'animate-spin' : undefined} />
                    }
                  />
                  <IconButton
                    label={`Unlink ${repo.owner}/${repo.repo}`}
                    variant="danger"
                    size="md"
                    onClick={() => setUnlinkTarget(repo)}
                    icon={<Trash2 />}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sync Settings Info */}
      {hasLinkedRepos && (
        <div className="card p-6 bg-blue-50 border-blue-200">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">Two-Way Sync Enabled</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• GitHub issues sync as tasks in this project</li>
            <li>• Task title and description changes sync back to GitHub</li>
            <li>• Moving a task to "Done" closes the linked GitHub issue</li>
            <li>• Comments added in TasksFlow appear on GitHub issues</li>
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={unlinkTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUnlinkTarget(null);
        }}
        title={`Unlink ${unlinkTarget ? `${unlinkTarget.owner}/${unlinkTarget.repo}` : 'repository'}?`}
        description="Existing tasks remain, but they no longer sync with GitHub."
        confirmLabel="Unlink"
        variant="danger"
        onConfirm={async () => {
          if (!unlinkTarget) return;
          await unlinkMutation.mutateAsync({ owner: unlinkTarget.owner, repo: unlinkTarget.repo });
          toast.success('Repository unlinked');
        }}
      />
    </div>
  );
}
