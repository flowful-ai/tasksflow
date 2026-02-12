import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { Routes, Route, Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { User, Building2, Link2, Bot, Eye, Users, Shield, Plug } from 'lucide-react';
import clsx from 'clsx';
import type { AppRole } from '@flowtask/shared';
import { useWorkspaceStore } from '../stores/workspace';
import { AgentSettings } from '../components/settings/AgentSettings';
import { SmartViewForm } from '../components/smart-views/SmartViewForm';
import { MemberSettings } from '../components/settings/MemberSettings';
import { AppOverviewSettings } from '../components/settings/AppOverviewSettings';
import { AppUserManagementSettings } from '../components/settings/AppUserManagementSettings';
import { authApi, type LinkedAccount } from '../api/auth';
import { ApiError, appAdminApi, workspaceApiKeyApi } from '../api/client';

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

function AppScopeForbidden() {
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">App Settings</h2>
      <p className="text-sm text-gray-600">
        App settings are available only to app managers.
      </p>
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
    if (!githubEnabled) {
      setError('GitHub integration is not configured.');
      return;
    }

    setIsMutating(true);
    setError(null);

    try {
      const callbackURL = `${window.location.origin}/settings/user/integrations`;
      const response = await authApi.linkSocial({
        provider: 'github',
        callbackURL,
        scopes: ['repo', 'read:user', 'user:email'],
      });

      if (response.redirect && response.url) {
        window.location.href = response.url;
        return;
      }

      await loadAccounts();
    } catch (err) {
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
        Connect TasksFlow with GitHub, Slack, and other tools.
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
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id;
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isForbidden, setIsForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadStatus = async (id: string) => {
    setIsLoadingStatus(true);
    setError(null);
    setSuccess(null);
    setIsForbidden(false);

    try {
      const response = await workspaceApiKeyApi.status(id, 'openrouter');
      setHasKey(response.data.hasKey);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setIsForbidden(true);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load API key status');
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    if (!workspaceId) return;
    loadStatus(workspaceId);
  }, [workspaceId]);

  const handleSave = async () => {
    if (!workspaceId || !apiKey.trim()) return;

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await workspaceApiKeyApi.upsert(workspaceId, { provider: 'openrouter', apiKey: apiKey.trim() });
      setApiKey('');
      setSuccess('Workspace API key saved.');
      await loadStatus(workspaceId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setIsForbidden(true);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!workspaceId) return;

    setIsDeleting(true);
    setError(null);
    setSuccess(null);

    try {
      await workspaceApiKeyApi.delete(workspaceId, 'openrouter');
      setSuccess('Workspace API key deleted.');
      await loadStatus(workspaceId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setIsForbidden(true);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to delete API key');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!workspaceId) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Workspace API Keys</h2>
        <p className="text-gray-600">Select a workspace to manage API keys.</p>
      </div>
    );
  }

  if (isForbidden) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Workspace API Keys</h2>
        <p className="text-gray-600">Only workspace owners and admins can manage API keys.</p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Workspace API Keys</h2>
      <p className="text-gray-600 mb-6">
        Configure the OpenRouter API key for this workspace.
      </p>

      <div className="mb-4 text-sm text-gray-600">
        Workspace: <span className="font-medium text-gray-900">{currentWorkspace?.name}</span>
      </div>

      {isLoadingStatus ? (
        <div className="mb-4 text-sm text-gray-500">Loading key status...</div>
      ) : (
        <div className="mb-4 text-sm text-gray-600">
          Status:{' '}
          <span className={hasKey ? 'text-green-700 font-medium' : 'text-amber-700 font-medium'}>
            {hasKey ? 'Configured' : 'Not configured'}
          </span>
        </div>
      )}

      {error && <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>}
      {success && <div className="mb-4 p-3 text-sm text-green-700 bg-green-50 rounded-lg">{success}</div>}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            OpenRouter API Key
          </label>
          <input
            type="password"
            className="input"
            placeholder="sk-or-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
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
        <div className="flex items-center gap-3">
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isSaving || !apiKey.trim()}
          >
            {isSaving ? 'Saving...' : hasKey ? 'Update API Key' : 'Save API Key'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleDelete}
            disabled={isDeleting || !hasKey}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
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
          onClick={() => navigate('/settings/workspace/views/new')}
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
            <span className="text-gray-500 text-sm mr-1">tasksflow.app/</span>
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
            This will be your workspace&apos;s unique identifier.
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

type NavigationItem = {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

type NavigationSection = {
  title: string;
  description: string;
  items: NavigationItem[];
};

export function SettingsPage() {
  const location = useLocation();
  const [isLoadingAppContext, setIsLoadingAppContext] = useState(true);
  const [appRole, setAppRole] = useState<AppRole | null>(null);
  const [appContextError, setAppContextError] = useState<string | null>(null);

  useEffect(() => {
    const loadAppContext = async () => {
      setIsLoadingAppContext(true);
      setAppContextError(null);

      try {
        const response = await appAdminApi.me();
        setAppRole(response.data.appRole);
      } catch (err) {
        setAppRole(null);
        setAppContextError(err instanceof Error ? err.message : 'Failed to load app context');
      } finally {
        setIsLoadingAppContext(false);
      }
    };

    loadAppContext();
  }, []);

  const isAppManager = appRole === 'app_manager';

  const navigationSections = useMemo<NavigationSection[]>(() => {
    const sections: NavigationSection[] = [
      {
        title: 'User Settings',
        description: 'Personal settings for your account.',
        items: [
          { name: 'Profile', href: '/settings/user/profile', icon: User },
          { name: 'Integrations', href: '/settings/user/integrations', icon: Link2 },
        ],
      },
      {
        title: 'Workspace Settings',
        description: 'Settings for the selected workspace.',
        items: [
          { name: 'Workspace', href: '/settings/workspace/general', icon: Building2 },
          { name: 'Members', href: '/settings/workspace/members', icon: Users },
          { name: 'Views', href: '/settings/workspace/views', icon: Eye },
          { name: 'Agent', href: '/settings/workspace/api-keys', icon: Bot },
          { name: 'MCP Connections', href: '/settings/workspace/agents', icon: Plug },
        ],
      },
    ];

    if (isAppManager) {
      sections.push({
        title: 'App Settings',
        description: 'Global settings for the whole application.',
        items: [
          { name: 'Overview', href: '/settings/app/overview', icon: Shield },
          { name: 'User Management', href: '/settings/app/users', icon: Users },
        ],
      });
    }

    return sections;
  }, [isAppManager]);

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Settings</h1>
      <p className="text-sm text-gray-600 mb-6">
        Settings are separated by scope: user, workspace, and app.
      </p>

      {appContextError && (
        <div className="mb-4 p-3 text-sm text-amber-700 bg-amber-50 rounded-lg">
          {appContextError}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-6">
        <nav className="w-full md:w-64 space-y-4">
          {navigationSections.map((section) => (
            <div key={section.title} className="border border-gray-200 rounded-lg p-3">
              <h2 className="text-sm font-semibold text-gray-900">{section.title}</h2>
              <p className="text-xs text-gray-500 mt-1 mb-2">{section.description}</p>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    location.pathname === item.href || location.pathname.startsWith(`${item.href}/`);

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
              </div>
            </div>
          ))}
        </nav>

        <div className="flex-1">
          <Routes>
            <Route index element={<Navigate to="user/profile" replace />} />

            <Route path="user/profile" element={<ProfileSettings />} />
            <Route path="user/integrations" element={<IntegrationSettings />} />
            <Route path="user/api-keys" element={<Navigate to="/settings/workspace/api-keys" replace />} />

            <Route path="workspace/general" element={<WorkspaceSettings />} />
            <Route path="workspace/new" element={<NewWorkspaceSettings />} />
            <Route path="workspace/members" element={<MemberSettings />} />
            <Route path="workspace/views" element={<ViewsSettings />} />
            <Route path="workspace/views/new" element={<SmartViewForm />} />
            <Route path="workspace/views/:viewId/edit" element={<SmartViewForm />} />
            <Route path="workspace/api-keys" element={<ApiKeySettings />} />
            <Route path="workspace/agents" element={<AgentSettings />} />

            <Route
              path="app/overview"
              element={isAppManager ? <AppOverviewSettings appRole={appRole} /> : <AppScopeForbidden />}
            />
            <Route
              path="app/users"
              element={isAppManager ? <AppUserManagementSettings isAppManager={isAppManager} /> : <AppScopeForbidden />}
            />

            {/* Legacy compatibility paths */}
            <Route path="profile" element={<Navigate to="/settings/user/profile" replace />} />
            <Route path="integrations" element={<Navigate to="/settings/user/integrations" replace />} />
            <Route path="api-keys" element={<Navigate to="/settings/workspace/api-keys" replace />} />
            <Route path="workspace" element={<Navigate to="/settings/workspace/general" replace />} />
            <Route path="workspaces/new" element={<Navigate to="/settings/workspace/new" replace />} />
            <Route path="members" element={<Navigate to="/settings/workspace/members" replace />} />
            <Route path="views" element={<Navigate to="/settings/workspace/views" replace />} />
            <Route path="views/new" element={<Navigate to="/settings/workspace/views/new" replace />} />
            <Route path="views/:viewId/edit" element={<SmartViewForm />} />
            <Route path="agents" element={<Navigate to="/settings/workspace/agents" replace />} />
          </Routes>
        </div>
      </div>

      {isLoadingAppContext && (
        <div className="mt-4 text-xs text-gray-500">Loading app permissions...</div>
      )}
    </div>
  );
}
