/** Workspace settings → AI & Agents: provider keys, agents, chat defaults (owner/admin). */
import { useState } from 'react';
import clsx from 'clsx';
import { ApiError } from '../../api/http';
import { agentApi, type AgentSummary } from '../../api/agents';
import type { ApiKeyProvider, WorkspaceAiSettings } from '../../api/workspaces';
import {
  useAgentMutations,
  useAgents,
  useAiSettings,
  useApiKeyMutations,
  useApiKeyStatuses,
  useCurrentWorkspace,
  useUpdateAiSettings,
} from '../../hooks/queries';
import { ConfirmDialog, ErrorState, Spinner, toast } from '../ui';
import { AVAILABLE_PERMISSIONS } from './AgentSettings';

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

const EMPTY_PROVIDER_INPUTS: Record<ApiKeyProvider, string> = {
  openai: '',
  anthropic: '',
  google: '',
  openrouter: '',
};
const DEFAULT_AGENT_TOOLS = ['query_tasks', 'get_task', 'list_projects'];

interface AgentFormState {
  name: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  requestsPerMinute: string;
  tokensPerDay: string;
  isActive: boolean;
}

const EMPTY_AGENT_FORM: AgentFormState = {
  name: '',
  model: '',
  systemPrompt: '',
  tools: [...DEFAULT_AGENT_TOOLS],
  requestsPerMinute: '10',
  tokensPerDay: '100000',
  isActive: true,
};

function parsePositiveInt(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isForbidden(error: Error | null): boolean {
  return error instanceof ApiError && error.status === 403;
}

export function AiSettings() {
  const { workspace } = useCurrentWorkspace();
  const workspaceId = workspace?.id ?? '';

  const keyStatus = useApiKeyStatuses(workspace?.id);
  const forbidden = isForbidden(keyStatus.error);
  const aiSettingsQuery = useAiSettings(workspace?.id, !forbidden);
  const agentsQuery = useAgents(workspace?.id, 'all', !forbidden);
  const keyMutations = useApiKeyMutations(workspaceId);
  const agentMutations = useAgentMutations(workspaceId);
  const updateAiSettings = useUpdateAiSettings(workspaceId);

  const [apiKeys, setApiKeys] = useState<Record<ApiKeyProvider, string>>(EMPTY_PROVIDER_INPUTS);
  const [agentForm, setAgentForm] = useState<AgentFormState>(EMPTY_AGENT_FORM);
  const [agentFormError, setAgentFormError] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [deletingAgent, setDeletingAgent] = useState<AgentSummary | null>(null);
  const [deletingKey, setDeletingKey] = useState<ApiKeyProvider | null>(null);

  const statusByProvider = keyStatus.data;
  const aiSettings = aiSettingsQuery.data;
  const agents = agentsQuery.data ?? [];
  const activeAgents = agents.filter((agent) => agent.isActive);
  const hasProviderKey = statusByProvider ? Object.values(statusByProvider).some(Boolean) : false;
  const isSavingAgent = agentMutations.create.isPending || agentMutations.update.isPending;

  if (!workspace) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">AI & Agents</h2>
        <p className="text-gray-600">Select a workspace to manage AI settings.</p>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">AI & Agents</h2>
        <p className="text-gray-600">Only workspace owners and admins can manage AI settings.</p>
      </div>
    );
  }

  if (keyStatus.error) {
    return (
      <div className="card p-6">
        <ErrorState
          error={keyStatus.error}
          resource="AI configuration"
          onRetry={() => void keyStatus.refetch()}
        />
      </div>
    );
  }

  const saveKey = (provider: ApiKeyProvider) => {
    const apiKey = apiKeys[provider].trim();
    if (!apiKey) return;
    keyMutations.save.mutate(
      { provider, apiKey },
      {
        onSuccess: () => {
          setApiKeys((prev) => ({ ...prev, [provider]: '' }));
          toast.success(`${provider.toUpperCase()} API key saved`);
        },
      }
    );
  };

  const resetAgentForm = () => {
    setAgentForm(EMPTY_AGENT_FORM);
    setEditingAgentId(null);
    setAgentFormError(null);
  };

  const beginEditAgent = async (agent: AgentSummary) => {
    setAgentFormError(null);
    try {
      const detail = await agentApi.get(agent.id);
      setEditingAgentId(detail.id);
      setAgentForm({
        name: detail.name,
        model: detail.model,
        systemPrompt: detail.systemPrompt ?? '',
        tools: detail.tools.length > 0 ? detail.tools : [...DEFAULT_AGENT_TOOLS],
        requestsPerMinute: String(detail.requestsPerMinute),
        tokensPerDay: String(detail.tokensPerDay),
        isActive: detail.isActive,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load agent details');
    }
  };

  const saveDefaultAgent = async (
    agentId: string | null,
    current: WorkspaceAiSettings | undefined = aiSettings
  ) => {
    if (!current) return;
    await updateAiSettings.mutateAsync({ ...current, defaultAgentId: agentId });
  };

  const saveAgent = () => {
    const name = agentForm.name.trim();
    const model = agentForm.model.trim();
    if (!name) return setAgentFormError('Agent name is required.');
    if (!model || !model.includes('/'))
      return setAgentFormError('Model must follow "provider/model" format.');
    if (agentForm.tools.length === 0) return setAgentFormError('Select at least one tool.');
    const requestsPerMinute = parsePositiveInt(agentForm.requestsPerMinute);
    if (!requestsPerMinute)
      return setAgentFormError('Requests per minute must be a positive whole number.');
    const tokensPerDay = parsePositiveInt(agentForm.tokensPerDay);
    if (!tokensPerDay)
      return setAgentFormError('Daily token limit must be a positive whole number.');
    setAgentFormError(null);

    const payload = {
      name,
      model,
      systemPrompt: agentForm.systemPrompt.trim() || undefined,
      tools: agentForm.tools,
      requestsPerMinute,
      tokensPerDay,
    };
    const onSuccess = () => {
      toast.success(editingAgentId ? 'Agent updated' : 'Agent created');
      resetAgentForm();
    };
    if (editingAgentId) {
      agentMutations.update.mutate(
        { agentId: editingAgentId, ...payload, isActive: agentForm.isActive },
        { onSuccess }
      );
    } else {
      agentMutations.create.mutate(payload, { onSuccess });
    }
  };

  const toggleAgentStatus = async (agent: AgentSummary) => {
    await agentMutations.update.mutateAsync({ agentId: agent.id, isActive: !agent.isActive });
    if (agent.isActive && aiSettings?.defaultAgentId === agent.id) await saveDefaultAgent(null);
    toast.success(agent.isActive ? 'Agent deactivated' : 'Agent activated');
  };

  const deleteAgent = async (agent: AgentSummary) => {
    await agentMutations.remove.mutateAsync(agent.id);
    if (aiSettings?.defaultAgentId === agent.id) await saveDefaultAgent(null);
    if (editingAgentId === agent.id) resetAgentForm();
    toast.success('Agent deleted');
  };

  const setField = <K extends keyof AgentFormState>(key: K, value: AgentFormState[K]) =>
    setAgentForm((previous) => ({ ...previous, [key]: value }));

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">AI & Agents</h2>
      <p className="text-gray-600 mb-6">
        Set up provider keys, create agents, and choose the default chat agent for your workspace.
      </p>
      <div className="mb-4 text-sm text-gray-600">
        Workspace: <span className="font-medium text-gray-900">{workspace.name}</span>
      </div>
      <div className="mb-6 rounded-lg border border-primary-100 bg-primary-50 p-4 text-sm text-primary-900">
        <div className="font-medium">Recommended flow</div>
        <div className="mt-1">
          1. Add at least one provider key. 2. Create agents. 3. Pick a default chat agent.
        </div>
      </div>

      {keyStatus.isLoading && <Spinner label="Loading key status" className="mb-4" />}

      <section aria-label="Provider API keys" className="space-y-5">
        {API_KEY_PROVIDERS.map((config) => {
          const hasKey = statusByProvider?.[config.provider] ?? false;
          const isSaving =
            keyMutations.save.isPending &&
            keyMutations.save.variables?.provider === config.provider;
          const keyValue = apiKeys[config.provider];
          const inputId = `api-key-${config.provider}`;
          return (
            <div key={config.provider} className="rounded-lg border border-gray-200 p-4">
              <div className="mb-4">
                <h3 className="text-base font-medium text-gray-900">{config.label}</h3>
                <div className="text-sm text-gray-600">
                  Status:{' '}
                  <span
                    className={hasKey ? 'text-green-700 font-medium' : 'text-amber-700 font-medium'}
                  >
                    {hasKey ? 'Configured' : 'Not configured'}
                  </span>
                </div>
              </div>
              <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-gray-700">
                {config.label} API Key
              </label>
              <input
                id={inputId}
                type="password"
                autoComplete="off"
                className="input"
                placeholder={config.placeholder}
                value={keyValue}
                onChange={(e) =>
                  setApiKeys((prev) => ({ ...prev, [config.provider]: e.target.value }))
                }
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
                  type="button"
                  className="btn btn-primary"
                  onClick={() => saveKey(config.provider)}
                  disabled={isSaving || !keyValue.trim()}
                >
                  {isSaving ? 'Saving...' : hasKey ? 'Update API Key' : 'Save API Key'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setDeletingKey(config.provider)}
                  disabled={!hasKey}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <section
        aria-labelledby="agents-heading"
        className="mt-8 rounded-lg border border-gray-200 p-4"
      >
        <h3 id="agents-heading" className="text-base font-medium text-gray-900">
          Agents
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          Create and manage reusable assistant profiles for workspace chat.
        </p>
        {!hasProviderKey && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Configure at least one provider key before creating agents.
          </div>
        )}
        {agentsQuery.isLoading ? (
          <Spinner label="Loading agents" className="mt-3" />
        ) : (
          <ul className="mt-4 space-y-2">
            {agents.length === 0 ? (
              <li className="text-sm text-gray-500">
                No agents yet. Create your first agent below.
              </li>
            ) : (
              agents.map((agent) => (
                <li key={agent.id} className="rounded-md border border-gray-200 px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{agent.name}</span>
                        <span
                          className={clsx(
                            'rounded px-2 py-0.5 text-xs font-medium',
                            agent.isActive
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-600'
                          )}
                        >
                          {agent.isActive ? 'Active' : 'Inactive'}
                        </span>
                        {aiSettings?.defaultAgentId === agent.id && (
                          <span className="rounded bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                            Default chat agent
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs font-mono text-gray-600">{agent.model}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary !px-2 !py-1 text-xs"
                        onClick={() => void beginEditAgent(agent)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary !px-2 !py-1 text-xs"
                        onClick={() => void toggleAgentStatus(agent).catch(() => undefined)}
                        disabled={isSavingAgent}
                      >
                        {agent.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary !px-2 !py-1 text-xs"
                        onClick={() =>
                          void saveDefaultAgent(agent.id)
                            .then(() => toast.success('Chat defaults saved'))
                            .catch(() => undefined)
                        }
                        disabled={
                          !agent.isActive ||
                          aiSettings?.defaultAgentId === agent.id ||
                          updateAiSettings.isPending
                        }
                      >
                        Set default
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary !px-2 !py-1 text-xs"
                        onClick={() => setDeletingAgent(agent)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        )}

        <form
          className="mt-5 rounded-lg border border-gray-200 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveAgent();
          }}
        >
          <h4 className="text-sm font-semibold text-gray-900">
            {editingAgentId ? 'Edit Agent' : 'Create Agent'}
          </h4>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="agent-name" className="mb-1 block text-sm font-medium text-gray-700">
                Name
              </label>
              <input
                id="agent-name"
                className="input"
                value={agentForm.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="Support assistant"
              />
            </div>
            <div>
              <label htmlFor="agent-model" className="mb-1 block text-sm font-medium text-gray-700">
                Model
              </label>
              <input
                id="agent-model"
                className="input"
                value={agentForm.model}
                onChange={(e) => setField('model', e.target.value)}
                placeholder="openai/gpt-4.1"
              />
            </div>
            <div className="md:col-span-2">
              <label
                htmlFor="agent-prompt"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                System Prompt (optional)
              </label>
              <textarea
                id="agent-prompt"
                className="input min-h-[96px]"
                value={agentForm.systemPrompt}
                onChange={(e) => setField('systemPrompt', e.target.value)}
                placeholder="You are a concise project assistant..."
              />
            </div>
            <div>
              <label htmlFor="agent-rpm" className="mb-1 block text-sm font-medium text-gray-700">
                Requests / minute
              </label>
              <input
                id="agent-rpm"
                inputMode="numeric"
                className="input"
                value={agentForm.requestsPerMinute}
                onChange={(e) => setField('requestsPerMinute', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="agent-tpd" className="mb-1 block text-sm font-medium text-gray-700">
                Tokens / day
              </label>
              <input
                id="agent-tpd"
                inputMode="numeric"
                className="input"
                value={agentForm.tokensPerDay}
                onChange={(e) => setField('tokensPerDay', e.target.value)}
              />
            </div>
          </div>
          <fieldset className="mt-4">
            <legend className="mb-2 block text-sm font-medium text-gray-700">Tools</legend>
            <div className="grid gap-2 md:grid-cols-2">
              {AVAILABLE_PERMISSIONS.map((tool) => (
                <label
                  key={tool.id}
                  className="flex items-center gap-2 rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={agentForm.tools.includes(tool.id)}
                    onChange={() =>
                      setField(
                        'tools',
                        agentForm.tools.includes(tool.id)
                          ? agentForm.tools.filter((id) => id !== tool.id)
                          : [...agentForm.tools, tool.id]
                      )
                    }
                  />
                  <span>{tool.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {editingAgentId && (
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={agentForm.isActive}
                onChange={(e) => setField('isActive', e.target.checked)}
              />
              Agent is active
            </label>
          )}
          {agentFormError && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {agentFormError}
            </p>
          )}
          <div className="mt-4 flex items-center gap-2">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSavingAgent || !hasProviderKey}
            >
              {isSavingAgent ? 'Saving...' : editingAgentId ? 'Save Agent' : 'Create Agent'}
            </button>
            {editingAgentId && (
              <button type="button" className="btn btn-secondary" onClick={resetAgentForm}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section
        aria-labelledby="chat-defaults-heading"
        className="mt-8 rounded-lg border border-gray-200 p-4"
      >
        <h3 id="chat-defaults-heading" className="text-base font-medium text-gray-900">
          Chat Defaults
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          Choose the default agent used by in-app workspace chat.
        </p>
        {aiSettingsQuery.error ? (
          <ErrorState
            error={aiSettingsQuery.error}
            resource="chat defaults"
            onRetry={() => void aiSettingsQuery.refetch()}
          />
        ) : !aiSettings ? (
          <Spinner label="Loading chat defaults" className="mt-3" />
        ) : (
          <div className="mt-4">
            <label htmlFor="default-agent" className="mb-1 block text-sm font-medium text-gray-700">
              Default Agent
            </label>
            <select
              id="default-agent"
              className="input"
              value={aiSettings.defaultAgentId ?? ''}
              onChange={(e) =>
                void saveDefaultAgent(e.target.value || null)
                  .then(() => toast.success('Chat defaults saved'))
                  .catch(() => undefined)
              }
              disabled={updateAiSettings.isPending}
            >
              <option value="">No default agent</option>
              {activeAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deletingAgent !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingAgent(null);
        }}
        title={`Delete agent "${deletingAgent?.name ?? ''}"?`}
        description="This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (deletingAgent) await deleteAgent(deletingAgent);
        }}
      />
      <ConfirmDialog
        open={deletingKey !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingKey(null);
        }}
        title={`Delete the ${deletingKey?.toUpperCase() ?? ''} API key?`}
        description="Agents using this provider stop working until a new key is saved."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!deletingKey) return;
          await keyMutations.remove.mutateAsync(deletingKey);
          toast.success(`${deletingKey.toUpperCase()} API key deleted`);
        }}
      />
    </div>
  );
}
