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
import {
  ApiError,
  appAdminApi,
  workspaceApiKeyApi,
  workspaceAiSettingsApi,
  agentApi,
  type ApiKeyProvider,
  type AIModel,
  type AgentSummary,
  type WorkspaceAiSettings,
} from '../api/client';

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

const API_KEY_PROVIDERS: {
  provider: ApiKeyProvider;
  label: string;
  placeholder: string;
  docsUrl: string;
  docsLabel: string;
}[] = [
  {
    provider: 'openai',
    label: 'OpenAI',
    placeholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    docsLabel: 'platform.openai.com',
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    placeholder: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    docsLabel: 'console.anthropic.com',
  },
  {
    provider: 'google',
    label: 'Google AI',
    placeholder: 'AIza...',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    docsLabel: 'aistudio.google.com',
  },
  {
    provider: 'openrouter',
    label: 'OpenRouter',
    placeholder: 'sk-or-...',
    docsUrl: 'https://openrouter.ai/keys',
    docsLabel: 'openrouter.ai',
  },
];

const EMPTY_PROVIDER_STATUS: Record<ApiKeyProvider, boolean> = {
  openai: false,
  anthropic: false,
  google: false,
  openrouter: false,
};

const EMPTY_PROVIDER_INPUTS: Record<ApiKeyProvider, string> = {
  openai: '',
  anthropic: '',
  google: '',
  openrouter: '',
};

function normalizeModelInput(rawModel: string): string | null {
  const trimmed = rawModel.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    return null;
  }

  const provider = trimmed.slice(0, slashIndex);
  const model = trimmed.slice(slashIndex + 1);

  if (!/^[a-z0-9][a-z0-9-]*$/i.test(provider)) {
    return null;
  }

  return `${provider.toLowerCase()}/${model}`;
}

function ApiKeySettings() {
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id;
  const [apiKeys, setApiKeys] = useState<Record<ApiKeyProvider, string>>(EMPTY_PROVIDER_INPUTS);
  const [statusByProvider, setStatusByProvider] = useState<Record<ApiKeyProvider, boolean>>(EMPTY_PROVIDER_STATUS);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [savingProvider, setSavingProvider] = useState<ApiKeyProvider | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<ApiKeyProvider | null>(null);
  const [isForbidden, setIsForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<WorkspaceAiSettings | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [isSavingAiSettings, setIsSavingAiSettings] = useState(false);
  const [modelInput, setModelInput] = useState('');
  const [modelInputError, setModelInputError] = useState<string | null>(null);

  const loadStatus = async (id: string) => {
    setIsLoadingStatus(true);
    setError(null);
    setSuccess(null);
    setIsForbidden(false);

    try {
      const response = await workspaceApiKeyApi.listStatuses(id);
      const nextStatus = { ...EMPTY_PROVIDER_STATUS };
      for (const entry of response.data.providers) {
        nextStatus[entry.provider] = entry.hasKey;
      }
      setStatusByProvider(nextStatus);
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

  useEffect(() => {
    if (!workspaceId || isForbidden) return;

    const loadAiConfig = async () => {
      try {
        const [settingsResponse, agentsResponse] = await Promise.all([
          workspaceAiSettingsApi.get(workspaceId),
          agentApi.list(workspaceId, true),
        ]);

        setAiSettings(settingsResponse.data);
        setAgents(agentsResponse.data);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load AI settings');
      }
    };

    loadAiConfig();
  }, [workspaceId, isForbidden]);

  const handleSave = async (provider: ApiKeyProvider) => {
    if (!workspaceId || !apiKeys[provider].trim()) return;

    setSavingProvider(provider);
    setError(null);
    setSuccess(null);

    try {
      await workspaceApiKeyApi.upsert(workspaceId, { provider, apiKey: apiKeys[provider].trim() });
      setApiKeys((prev) => ({ ...prev, [provider]: '' }));
      setSuccess(`${provider.toUpperCase()} API key saved.`);
      await loadStatus(workspaceId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setIsForbidden(true);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setSavingProvider(null);
    }
  };

  const handleDelete = async (provider: ApiKeyProvider) => {
    if (!workspaceId) return;

    setDeletingProvider(provider);
    setError(null);
    setSuccess(null);

    try {
      await workspaceApiKeyApi.delete(workspaceId, provider);
      setSuccess(`${provider.toUpperCase()} API key deleted.`);
      await loadStatus(workspaceId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setIsForbidden(true);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to delete API key');
    } finally {
      setDeletingProvider(null);
    }
  };

  const addModel = () => {
    if (!aiSettings) return;

    const normalizedModel = normalizeModelInput(modelInput);
    if (!normalizedModel) {
      setModelInputError('Model must follow "provider/model" format (for example: openai/gpt-4.1).');
      return;
    }

    if (aiSettings.allowedModels.includes(normalizedModel)) {
      setModelInputError('This model is already in the allowed list.');
      return;
    }

    setModelInput('');
    setModelInputError(null);
    setAiSettings({
      ...aiSettings,
      allowedModels: [...aiSettings.allowedModels, normalizedModel],
    });
  };

  const removeModel = (model: AIModel) => {
    setAiSettings((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        allowedModels: previous.allowedModels.filter((item) => item !== model),
      };
    });
  };

  const makeModelDefault = (model: AIModel) => {
    setAiSettings((previous) => {
      if (!previous || previous.allowedModels[0] === model) return previous;
      return {
        ...previous,
        allowedModels: [model, ...previous.allowedModels.filter((item) => item !== model)],
      };
    });
  };

  const handleSaveAiSettings = async () => {
    if (!workspaceId || !aiSettings) return;

    setIsSavingAiSettings(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await workspaceAiSettingsApi.update(workspaceId, aiSettings);
      setAiSettings(response.data);
      setSuccess('Workspace AI settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save AI settings');
    } finally {
      setIsSavingAiSettings(false);
    }
  };

  if (!workspaceId) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Workspace AI Keys</h2>
        <p className="text-gray-600">Select a workspace to manage API keys.</p>
      </div>
    );
  }

  if (isForbidden) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Workspace AI Keys</h2>
        <p className="text-gray-600">Only workspace owners and admins can manage API keys.</p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Workspace AI Keys</h2>
      <p className="text-gray-600 mb-6">
        Configure provider API keys for this workspace.
      </p>

      <div className="mb-4 text-sm text-gray-600">
        Workspace: <span className="font-medium text-gray-900">{currentWorkspace?.name}</span>
      </div>

      {isLoadingStatus && <div className="mb-4 text-sm text-gray-500">Loading key status...</div>}

      {error && <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>}
      {success && <div className="mb-4 p-3 text-sm text-green-700 bg-green-50 rounded-lg">{success}</div>}

      <div className="space-y-5">
        {API_KEY_PROVIDERS.map((config) => {
          const hasKey = statusByProvider[config.provider];
          const isSaving = savingProvider === config.provider;
          const isDeleting = deletingProvider === config.provider;
          const keyValue = apiKeys[config.provider];

          return (
            <div key={config.provider} className="rounded-lg border border-gray-200 p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-medium text-gray-900">{config.label}</h3>
                  <div className="text-sm text-gray-600">
                    Status:{' '}
                    <span className={hasKey ? 'text-green-700 font-medium' : 'text-amber-700 font-medium'}>
                      {hasKey ? 'Configured' : 'Not configured'}
                    </span>
                  </div>
                </div>
              </div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {config.label} API Key
              </label>
              <input
                type="password"
                className="input"
                placeholder={config.placeholder}
                value={keyValue}
                onChange={(e) => setApiKeys((prev) => ({ ...prev, [config.provider]: e.target.value }))}
              />
              <p className="mt-1 text-sm text-gray-500">
                Get your API key from{' '}
                <a
                  href={config.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 hover:underline"
                >
                  {config.docsLabel}
                </a>
              </p>
              <div className="mt-4 flex items-center gap-3">
                <button
                  className="btn btn-primary"
                  onClick={() => handleSave(config.provider)}
                  disabled={isSaving || !keyValue.trim()}
                >
                  {isSaving ? 'Saving...' : hasKey ? 'Update API Key' : 'Save API Key'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => handleDelete(config.provider)}
                  disabled={isDeleting || !hasKey}
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 p-4">
        <h3 className="text-base font-medium text-gray-900">Agent Chat Configuration</h3>
        <p className="mt-1 text-sm text-gray-600">
          Configure allowed models and default agent used by the in-app chat.
        </p>

        {!aiSettings ? (
          <div className="mt-3 text-sm text-gray-500">Loading chat settings...</div>
        ) : (
          <>
            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium text-gray-700">Allowed Models</label>
              <div className="flex items-start gap-2">
                <input
                  type="text"
                  className="input flex-1"
                  placeholder="provider/model (for example: openai/gpt-4.1)"
                  value={modelInput}
                  onChange={(event) => {
                    setModelInput(event.target.value);
                    if (modelInputError) {
                      setModelInputError(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addModel();
                    }
                  }}
                />
                <button className="btn btn-secondary" onClick={addModel}>
                  Add model
                </button>
              </div>
              {modelInputError && <p className="mt-2 text-sm text-red-600">{modelInputError}</p>}
              <div className="mt-3 space-y-2">
                {aiSettings.allowedModels.length === 0 ? (
                  <p className="text-sm text-gray-500">No models configured yet.</p>
                ) : (
                  aiSettings.allowedModels.map((model, index) => (
                    <div key={model} className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-700">{model}</span>
                        {index === 0 && (
                          <span className="rounded bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">Default</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="btn btn-secondary !px-2 !py-1 text-xs"
                          onClick={() => makeModelDefault(model)}
                          disabled={index === 0}
                        >
                          Make default
                        </button>
                        <button
                          className="btn btn-secondary !px-2 !py-1 text-xs"
                          onClick={() => removeModel(model)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-5">
              <label className="mb-1 block text-sm font-medium text-gray-700">Default Agent</label>
              <select
                className="input"
                value={aiSettings.defaultAgentId ?? ''}
                onChange={(event) =>
                  setAiSettings((previous) =>
                    previous
                      ? {
                          ...previous,
                          defaultAgentId: event.target.value || null,
                        }
                      : previous
                  )
                }
              >
                <option value="">No default agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4">
              <button className="btn btn-primary" onClick={handleSaveAiSettings} disabled={isSavingAiSettings}>
                {isSavingAiSettings ? 'Saving...' : 'Save Chat Configuration'}
              </button>
            </div>
          </>
        )}
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
          { name: 'AI Keys', href: '/settings/workspace/api-keys', icon: Bot },
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
