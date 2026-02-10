import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ExternalLink, Trash2, RefreshCw, Link2, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { githubApi, type GitHubRepository, type LinkedRepository } from '../../api/client';

// GitHub icon component (since lucide-react deprecated Github)
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

interface GitHubSettingsProps {
  projectId: string;
  onUpdated: () => void;
}

const GITHUB_APP_SLUG = import.meta.env.VITE_GITHUB_APP_SLUG;

export function GitHubSettings({ projectId, onUpdated }: GitHubSettingsProps) {
  const isGitHubAppConfigured = !!GITHUB_APP_SLUG;
  const [showRepoSelector, setShowRepoSelector] = useState(false);
  const [selectedInstallationId, setSelectedInstallationId] = useState<number | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<LinkedRepository | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repoFilter, setRepoFilter] = useState('');

  // Fetch current GitHub integration status
  const { data: integration, isLoading: integrationLoading, refetch: refetchIntegration } = useQuery({
    queryKey: ['github-integration', projectId],
    queryFn: () => githubApi.getIntegration(projectId),
  });

  // Fetch user's GitHub installations (to know if they can link repos)
  const { data: userInstallations } = useQuery({
    queryKey: ['github-user-installations'],
    queryFn: () => githubApi.getMyInstallations(),
  });

  // Check URL for installation callback and save installation ID
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const installationId = params.get('installation_id');
    const setupAction = params.get('setup_action');

    if (installationId && setupAction === 'install') {
      // Clear URL params immediately
      window.history.replaceState({}, '', window.location.pathname);

      const installId = parseInt(installationId, 10);
      setSelectedInstallationId(installId);
      setShowRepoSelector(true);

      // Save the installation ID to the backend
      githubApi.saveInstallation(projectId, installId)
        .then(() => {
          refetchIntegration();
        })
        .catch((err) => {
          setError(err.message || 'Failed to save installation');
        });
    }
  }, [projectId, refetchIntegration]);

  // Fetch available repos when installation ID is set
  const { data: availableRepos, isLoading: reposLoading } = useQuery({
    queryKey: ['github-repos', selectedInstallationId],
    queryFn: () => githubApi.listInstallationRepos(selectedInstallationId!),
    enabled: !!selectedInstallationId && showRepoSelector,
  });

  const normalizedRepoFilter = repoFilter.trim().toLowerCase();
  const filteredRepos = availableRepos?.filter((repo) => {
    if (!normalizedRepoFilter) return true;
    return repo.fullName.toLowerCase().includes(normalizedRepoFilter);
  });

  // Link repository mutation
  const linkMutation = useMutation({
    mutationFn: async (repo: GitHubRepository) => {
      return githubApi.linkRepository(projectId, {
        installationId: selectedInstallationId!,
        owner: repo.owner,
        repo: repo.name,
      });
    },
    onSuccess: () => {
      setShowRepoSelector(false);
      setError(null);
      refetchIntegration();
      onUpdated();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Unlink repository mutation
  const unlinkMutation = useMutation({
    mutationFn: async (repo: LinkedRepository) => {
      return githubApi.unlinkRepository(projectId, repo.owner, repo.repo);
    },
    onSuccess: () => {
      setUnlinkTarget(null);
      setError(null);
      refetchIntegration();
      onUpdated();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Trigger sync mutation
  const syncMutation = useMutation({
    mutationFn: async (repo: LinkedRepository) => {
      console.log(`[GitHub Sync] Triggering sync for ${repo.owner}/${repo.repo}`);
      return githubApi.triggerSync(projectId, repo.owner, repo.repo);
    },
    onSuccess: (data, repo) => {
      console.log(`[GitHub Sync] Sync completed for ${repo.owner}/${repo.repo}`, data);
      setError(null);
      refetchIntegration();
    },
    onError: (err: Error, repo) => {
      console.error(`[GitHub Sync] Sync failed for ${repo.owner}/${repo.repo}:`, err);
      setError(err.message);
    },
  });

  const handleInstallGitHubApp = () => {
    // Store the return URL so we can redirect back after GitHub installation
    const returnUrl = window.location.pathname;
    localStorage.setItem('github_install_return_url', returnUrl);
    // Redirect to GitHub App installation page with state parameter
    // State is passed through the OAuth flow when "Request user authorization during installation" is enabled
    const installUrl = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(returnUrl)}`;
    window.location.href = installUrl;
  };

  const hasLinkedRepos = integration?.repositories && integration.repositories.length > 0;

  if (integrationLoading) {
    return (
      <div className="card p-6">
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
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
          <div className="mt-4 p-3 text-sm text-red-600 bg-red-50 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!hasLinkedRepos && !showRepoSelector && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            {!isGitHubAppConfigured ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-amber-900 mb-2">GitHub App Not Configured</h3>
                <p className="text-sm text-amber-800 mb-3">
                  To enable GitHub integration, you need to create a GitHub App and configure it:
                </p>
                <ol className="text-sm text-amber-800 list-decimal list-inside space-y-1 mb-3">
                  <li>Go to GitHub Settings → Developer settings → GitHub Apps</li>
                  <li>Create a new GitHub App with these permissions:
                    <ul className="ml-5 mt-1 list-disc">
                      <li>Issues: Read & Write</li>
                      <li>Pull requests: Read</li>
                      <li>Contents: Read (for commit references)</li>
                    </ul>
                  </li>
                  <li>Set the callback URL to your app URL</li>
                  <li>Generate a private key</li>
                  <li>Set these environment variables:
                    <ul className="ml-5 mt-1 list-disc font-mono text-xs">
                      <li>GITHUB_APP_ID</li>
                      <li>GITHUB_APP_PRIVATE_KEY</li>
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
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-sm font-medium text-gray-900 mb-1">GitHub App Installed</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Link a repository to start syncing issues.
                </p>
                {userInstallations.length === 1 ? (
                  <button
                    onClick={() => {
                      setSelectedInstallationId(userInstallations[0].installationId);
                      setShowRepoSelector(true);
                    }}
                    className="btn btn-primary inline-flex items-center"
                  >
                    <Link2 className="w-4 h-4 mr-2" />
                    Link Repository
                    {userInstallations[0].accountLogin && (
                      <span className="ml-1 text-primary-200">({userInstallations[0].accountLogin})</span>
                    )}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500 mb-2">Choose an installation:</p>
                    {userInstallations.map((inst) => (
                      <button
                        key={inst.installationId}
                        onClick={() => {
                          setSelectedInstallationId(inst.installationId);
                          setShowRepoSelector(true);
                        }}
                        className="btn btn-primary inline-flex items-center mr-2"
                      >
                        <Link2 className="w-4 h-4 mr-2" />
                        {inst.accountLogin || `Installation #${inst.installationId}`}
                        {inst.accountType && (
                          <span className="ml-1 text-xs text-primary-200">({inst.accountType})</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-4">
                  <button
                    onClick={handleInstallGitHubApp}
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
                  <Link2 className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-sm font-medium text-gray-900 mb-1">No repositories linked</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Install the TasksFlow GitHub App to start syncing issues.
                </p>
                <button
                  onClick={handleInstallGitHubApp}
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
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : availableRepos?.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No repositories found in this installation.</p>
              <button
                onClick={handleInstallGitHubApp}
                className="mt-2 text-primary-600 hover:underline text-sm"
              >
                Configure GitHub App permissions
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <input
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
                    onClick={() => !isAlreadyLinked && linkMutation.mutate(repo)}
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
                      <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
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
            {isGitHubAppConfigured && userInstallations && userInstallations.length > 0 && (
              userInstallations.length === 1 ? (
                <button
                  onClick={() => {
                    setSelectedInstallationId(userInstallations[0].installationId);
                    setShowRepoSelector(true);
                  }}
                  className="text-sm text-primary-600 hover:underline flex items-center gap-1"
                >
                  <Link2 className="w-3 h-3" />
                  Add Repository
                </button>
              ) : (
                <div className="relative group">
                  <button className="text-sm text-primary-600 hover:underline flex items-center gap-1">
                    <Link2 className="w-3 h-3" />
                    Add Repository
                  </button>
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 hidden group-hover:block z-10">
                    {userInstallations.map((inst) => (
                      <button
                        key={inst.installationId}
                        onClick={() => {
                          setSelectedInstallationId(inst.installationId);
                          setShowRepoSelector(true);
                        }}
                        className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                      >
                        {inst.accountLogin || `Installation #${inst.installationId}`}
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
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
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <div className="flex items-center gap-2 mt-0.5">
                      {repo.syncStatus === 'synced' && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Synced
                        </span>
                      )}
                      {repo.syncStatus === 'syncing' && (
                        <span className="text-xs text-blue-600 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Syncing...
                        </span>
                      )}
                      {repo.syncStatus === 'error' && (
                        <span className="text-xs text-red-600 flex items-center gap-1" title={repo.syncError || undefined}>
                          <AlertCircle className="w-3 h-3" />
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
                  <button
                    onClick={() => syncMutation.mutate(repo)}
                    disabled={syncMutation.isPending || repo.syncStatus === 'syncing'}
                    className="btn btn-secondary p-2"
                    title="Sync now"
                  >
                    <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={() => setUnlinkTarget(repo)}
                    className="btn bg-red-50 text-red-600 hover:bg-red-100 p-2"
                    title="Unlink repository"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
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

      {/* Unlink Confirmation Modal */}
      {unlinkTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setUnlinkTarget(null)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Unlink Repository</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to unlink <strong>{unlinkTarget.owner}/{unlinkTarget.repo}</strong>?
              Existing tasks will remain, but they will no longer sync with GitHub.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setUnlinkTarget(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => unlinkMutation.mutate(unlinkTarget)}
                className="btn bg-red-600 text-white hover:bg-red-700"
                disabled={unlinkMutation.isPending}
              >
                {unlinkMutation.isPending ? 'Unlinking...' : 'Unlink'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
