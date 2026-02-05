import { useEffect, useMemo, useState } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { User, Building2, Link2, Key, Bot, Eye } from 'lucide-react';
import clsx from 'clsx';
import { useWorkspaceStore } from '../stores/workspace';
import { AgentSettings } from '../components/settings/AgentSettings';
import { SmartViewForm } from '../components/smart-views/SmartViewForm';
import { authApi, type LinkedAccount } from '../api/auth';

function ProfileSettings() {
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Profile Settings</h2>
      <p className="text-gray-600">Profile settings coming soon...</p>
    </div>
  );
}

function WorkspaceSettings() {
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Workspace Settings</h2>
      <p className="text-gray-600">Workspace settings coming soon...</p>
    </div>
  );
}

function IntegrationSettings() {
  const [accounts, setAccounts] = useState<LinkedAccount[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const githubEnabled = Boolean(import.meta.env.VITE_GITHUB_CLIENT_ID);

  const githubAccount = useMemo(
    () => accounts?.find((account) => account.providerId === 'github'),
    [accounts]
  );

  const loadAccounts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await authApi.listAccounts();
      setAccounts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleConnectGithub = async () => {
    console.log('[handleConnectGithub] Called, githubEnabled:', githubEnabled);
    if (!githubEnabled) {
      setError('GitHub integration is not configured.');
      return;
    }

    setIsMutating(true);
    setError(null);

    try {
      const callbackURL = `${window.location.origin}/settings/integrations`;
      console.log('[handleConnectGithub] Calling linkSocial with callbackURL:', callbackURL);
      const response = await authApi.linkSocial({
        provider: 'github',
        callbackURL,
        scopes: ['repo', 'read:user', 'user:email'],
      });

      console.log('[handleConnectGithub] Response:', response);
      if (response.redirect && response.url) {
        console.log('[handleConnectGithub] Redirecting to:', response.url);
        window.location.href = response.url;
        return;
      }

      await loadAccounts();
    } catch (err) {
      console.error('[handleConnectGithub] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect GitHub');
    } finally {
      setIsMutating(false);
    }
  };

  const handleDisconnectGithub = async () => {
    if (!githubAccount) return;

    setIsMutating(true);
    setError(null);

    try {
      await authApi.unlinkAccount({
        providerId: 'github',
        accountId: githubAccount.accountId,
      });
      await loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect GitHub');
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Integrations</h2>
      <p className="text-gray-600">
        Connect FlowTask with GitHub, Slack, and other tools.
      </p>

      {error && (
        <div className="mt-4 p-3 text-sm text-red-600 bg-red-50 rounded-lg">
          {error}
        </div>
      )}

      <div className="mt-6 space-y-4">
        <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-gray-900">GitHub</h3>
              <p className="text-sm text-gray-500">Sync issues and pull requests</p>
              {isLoading ? (
                <p className="text-xs text-gray-400 mt-1">Checking connection…</p>
              ) : githubAccount ? (
                <p className="text-xs text-green-600 mt-1">Connected</p>
              ) : githubEnabled ? (
                <p className="text-xs text-gray-400 mt-1">Not connected</p>
              ) : (
                <p className="text-xs text-amber-600 mt-1">Not configured</p>
              )}
            </div>
          </div>
          {githubAccount ? (
            <button
              className="btn btn-secondary"
              onClick={handleDisconnectGithub}
              disabled={isMutating}
            >
              {isMutating ? 'Disconnecting...' : 'Disconnect'}
            </button>
          ) : (
            <button
              className="btn btn-secondary"
              onClick={handleConnectGithub}
              disabled={isMutating || !githubEnabled}
              title={!githubEnabled ? 'GitHub OAuth not configured' : undefined}
            >
              {isMutating ? 'Connecting...' : 'Connect'}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-gray-900">Slack</h3>
              <p className="text-sm text-gray-500">Get notifications in Slack</p>
            </div>
          </div>
          <button className="btn btn-secondary">Connect</button>
        </div>
      </div>
    </div>
  );
}

function ApiKeySettings() {
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">API Keys</h2>
      <p className="text-gray-600 mb-6">
        Configure your OpenRouter API key to enable AI agent features.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            OpenRouter API Key
          </label>
          <input
            type="password"
            className="input"
            placeholder="sk-or-..."
          />
          <p className="mt-1 text-sm text-gray-500">
            Get your API key from{' '}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 hover:underline"
            >
              openrouter.ai
            </a>
          </p>
        </div>
        <button className="btn btn-primary">Save API Key</button>
      </div>
    </div>
  );
}

function ViewsSettings() {
  const navigate = useNavigate();

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Views</h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage your saved filtered views.
          </p>
        </div>
        <button
          onClick={() => navigate('/settings/views/new')}
          className="btn btn-primary"
        >
          New View
        </button>
      </div>
      <p className="text-gray-600">
        Go to the <Link to="/views" className="text-primary-600 hover:underline">Views page</Link> to see all your views, or create a new one above.
      </p>
    </div>
  );
}

function NewWorkspaceSettings() {
  const navigate = useNavigate();
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);
    setSlug(generateSlug(newName));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await createWorkspace(name.trim(), slug.trim());
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Create Workspace</h2>
      <p className="text-gray-600 mb-6">
        Create a new workspace to organize your projects and tasks.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Workspace Name
          </label>
          <input
            type="text"
            className="input"
            placeholder="My Workspace"
            value={name}
            onChange={handleNameChange}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Workspace URL
          </label>
          <div className="flex items-center">
            <span className="text-gray-500 text-sm mr-1">flowtask.app/</span>
            <input
              type="text"
              className="input flex-1"
              placeholder="my-workspace"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
            />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            This will be your workspace's unique identifier.
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting || !name.trim() || !slug.trim()}
          >
            {isSubmitting ? 'Creating...' : 'Create Workspace'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate(-1)}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export function SettingsPage() {
  const location = useLocation();

  const navigation = [
    { name: 'Profile', href: '/settings', icon: User },
    { name: 'Workspace', href: '/settings/workspace', icon: Building2 },
    { name: 'Views', href: '/settings/views', icon: Eye },
    { name: 'Integrations', href: '/settings/integrations', icon: Link2 },
    { name: 'Agents', href: '/settings/agents', icon: Bot },
    { name: 'API Keys', href: '/settings/api-keys', icon: Key },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Navigation */}
        <nav className="w-full md:w-48 space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                className={clsx(
                  'flex items-center px-3 py-2 text-sm font-medium rounded-lg',
                  isActive
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-gray-700 hover:bg-gray-100'
                )}
              >
                <Icon className="w-5 h-5 mr-3" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Content */}
        <div className="flex-1">
          <Routes>
            <Route index element={<ProfileSettings />} />
            <Route path="workspace" element={<WorkspaceSettings />} />
            <Route path="workspaces/new" element={<NewWorkspaceSettings />} />
            <Route path="views" element={<ViewsSettings />} />
            <Route path="views/new" element={<SmartViewForm />} />
            <Route path="views/:viewId/edit" element={<SmartViewForm />} />
            <Route path="integrations" element={<IntegrationSettings />} />
            <Route path="agents" element={<AgentSettings />} />
            <Route path="api-keys" element={<ApiKeySettings />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
