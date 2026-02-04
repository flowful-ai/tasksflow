import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Plus,
  Pencil,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
  X,
  Calendar,
  Shield,
} from 'lucide-react';
import clsx from 'clsx';
import { useWorkspaceStore } from '../../stores/workspace';
import {
  workspaceAgentApi,
  type WorkspaceAgent,
  type WorkspaceAgentWithToken,
  type CreateWorkspaceAgentInput,
  type UpdateWorkspaceAgentInput,
} from '../../api/client';

// Available MCP tool permissions
const AVAILABLE_PERMISSIONS = [
  { id: 'create_task', label: 'Create tasks', description: 'Create new tasks in projects' },
  { id: 'update_task', label: 'Update tasks', description: 'Modify existing task details' },
  { id: 'delete_task', label: 'Delete tasks', description: 'Remove tasks permanently' },
  { id: 'query_tasks', label: 'Query tasks', description: 'Search and list tasks' },
  { id: 'move_task', label: 'Move tasks', description: 'Change task status/column' },
  { id: 'assign_task', label: 'Assign tasks', description: 'Assign users to tasks' },
  { id: 'add_comment', label: 'Add comments', description: 'Comment on tasks' },
  { id: 'summarize_project', label: 'Summarize project', description: 'Get project summaries' },
  { id: 'create_smart_view', label: 'Create smart views', description: 'Create smart views with filters' },
  { id: 'search_tasks', label: 'Search tasks', description: 'Full-text task search' },
  { id: 'list_projects', label: 'List projects', description: 'List all projects accessible to this agent' },
] as const;

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}

interface TokenDisplayDialogProps {
  token: string;
  isRegenerate?: boolean;
  onClose: () => void;
}

function TokenDisplayDialog({ token, isRegenerate, onClose }: TokenDisplayDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-lg shadow-xl p-6">
        <div className="flex items-center mb-4">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
            <Check className="w-5 h-5 text-green-600" />
          </div>
          <h2 className="ml-3 text-lg font-semibold text-gray-900">
            {isRegenerate ? 'Token Regenerated' : 'Agent Created'}
          </h2>
        </div>

        <p className="text-sm text-gray-600 mb-4">Your API Token:</p>

        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <code className="flex-1 text-sm font-mono text-gray-800 break-all">{token}</code>
          <button
            onClick={handleCopy}
            className="flex-shrink-0 p-2 rounded-lg hover:bg-gray-200 transition-colors"
            title="Copy to clipboard"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-600" />
            ) : (
              <Copy className="w-4 h-4 text-gray-500" />
            )}
          </button>
        </div>

        <div className="flex items-start gap-2 mt-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            This token will only be shown once. Store it securely.
            {isRegenerate && ' The previous token has been invalidated.'}
          </p>
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

interface AgentFormDialogProps {
  agent?: WorkspaceAgent;
  workspaceId: string;
  onClose: () => void;
  onSuccess: (agentWithToken?: WorkspaceAgentWithToken) => void;
}

function AgentFormDialog({ agent, workspaceId, onClose, onSuccess }: AgentFormDialogProps) {
  const { projects } = useWorkspaceStore();
  const isEditing = !!agent;

  const [name, setName] = useState(agent?.name || '');
  const [description, setDescription] = useState(agent?.description || '');
  const [permissions, setPermissions] = useState<string[]>(agent?.permissions || ['query_tasks']);
  const [projectAccess, setProjectAccess] = useState<'all' | 'specific'>(
    agent?.restrictedProjectIds && agent.restrictedProjectIds.length > 0 ? 'specific' : 'all'
  );
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    agent?.restrictedProjectIds || []
  );
  const [expiresAt, setExpiresAt] = useState(
    agent?.expiresAt ? new Date(agent.expiresAt).toISOString().split('T')[0] : ''
  );
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: CreateWorkspaceAgentInput) => workspaceAgentApi.create(workspaceId, data),
    onSuccess: (response) => {
      onSuccess(response.data);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: UpdateWorkspaceAgentInput) =>
      workspaceAgentApi.update(workspaceId, agent!.id, data),
    onSuccess: () => {
      onSuccess();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (permissions.length === 0) {
      setError('Please select at least one permission');
      return;
    }

    const data = {
      name: name.trim(),
      description: description.trim() || undefined,
      permissions,
      restrictedProjectIds: projectAccess === 'specific' ? selectedProjects : undefined,
      expiresAt: expiresAt || undefined,
    };

    if (isEditing) {
      updateMutation.mutate({
        ...data,
        restrictedProjectIds: projectAccess === 'specific' ? selectedProjects : null,
        expiresAt: expiresAt || null,
      });
    } else {
      createMutation.mutate(data);
    }
  };

  const togglePermission = (permId: string) => {
    setPermissions((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]
    );
  };

  const toggleProject = (projectId: string) => {
    setSelectedProjects((prev) =>
      prev.includes(projectId) ? prev.filter((p) => p !== projectId) : [...prev, projectId]
    );
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-lg shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Edit Agent' : 'Create Agent'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="e.g., CI Bot, Support Agent"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input min-h-[80px]"
              placeholder="What will this agent be used for?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Permissions *</label>
            <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto p-1">
              {AVAILABLE_PERMISSIONS.map((perm) => (
                <label
                  key={perm.id}
                  className={clsx(
                    'flex items-start p-3 rounded-lg border cursor-pointer transition-colors',
                    permissions.includes(perm.id)
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={permissions.includes(perm.id)}
                    onChange={() => togglePermission(perm.id)}
                    className="mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <div className="ml-3">
                    <span className="text-sm font-medium text-gray-900">{perm.label}</span>
                    <p className="text-xs text-gray-500">{perm.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Project Access</label>
            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="radio"
                  checked={projectAccess === 'all'}
                  onChange={() => setProjectAccess('all')}
                  className="text-primary-600 focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-gray-700">All projects in workspace</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  checked={projectAccess === 'specific'}
                  onChange={() => setProjectAccess('specific')}
                  className="text-primary-600 focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-gray-700">Specific projects only</span>
              </label>
            </div>

            {projectAccess === 'specific' && (
              <div className="mt-3 max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2">
                {projects.length === 0 ? (
                  <p className="text-sm text-gray-500 p-2">No projects available</p>
                ) : (
                  projects.map((project) => (
                    <label
                      key={project.id}
                      className="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedProjects.includes(project.id)}
                        onChange={() => toggleProject(project.id)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">
                        <span className="font-medium text-gray-500">{project.identifier}</span>{' '}
                        {project.name}
                      </span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <Calendar className="w-4 h-4 inline mr-1" />
              Expiration Date
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="input"
            />
            <p className="mt-1 text-xs text-gray-500">
              Leave empty for no expiration
            </p>
          </div>
        </form>

        <div className="flex justify-end gap-3 p-4 border-t border-gray-200">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || !name.trim() || permissions.length === 0}
            className="btn btn-primary"
          >
            {isLoading ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface AgentCardProps {
  agent: WorkspaceAgent;
  onEdit: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}

function AgentCard({ agent, onEdit, onRegenerate, onDelete }: AgentCardProps) {
  const { projects } = useWorkspaceStore();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

  const isExpired = agent.expiresAt && new Date(agent.expiresAt) < new Date();
  const projectNames = agent.restrictedProjectIds
    ? agent.restrictedProjectIds
        .map((id) => projects.find((p) => p.id === id)?.name)
        .filter(Boolean)
    : null;

  return (
    <div
      className={clsx(
        'p-4 border rounded-lg',
        !agent.isActive || isExpired ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200'
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              'w-10 h-10 rounded-lg flex items-center justify-center',
              agent.isActive && !isExpired ? 'bg-primary-100' : 'bg-gray-200'
            )}
          >
            <Bot
              className={clsx(
                'w-5 h-5',
                agent.isActive && !isExpired ? 'text-primary-600' : 'text-gray-500'
              )}
            />
          </div>
          <div>
            <h3 className="font-medium text-gray-900">{agent.name}</h3>
            {agent.description && (
              <p className="text-sm text-gray-500 mt-0.5">{agent.description}</p>
            )}
          </div>
        </div>
        <span
          className={clsx(
            'px-2 py-1 text-xs font-medium rounded-full',
            isExpired
              ? 'bg-red-100 text-red-700'
              : agent.isActive
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-600'
          )}
        >
          {isExpired ? 'Expired' : agent.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <Shield className="w-4 h-4 text-gray-400" />
          <span className="text-gray-600">
            {agent.permissions.length} permission{agent.permissions.length !== 1 ? 's' : ''}:{' '}
            <span className="text-gray-900">
              {agent.permissions.slice(0, 3).join(', ')}
              {agent.permissions.length > 3 && ` +${agent.permissions.length - 3} more`}
            </span>
          </span>
        </div>

        {projectNames && (
          <div className="text-sm text-gray-600">
            Projects:{' '}
            <span className="text-gray-900">
              {projectNames.length > 0 ? projectNames.join(', ') : 'None selected'}
            </span>
          </div>
        )}

        <div className="text-sm text-gray-500">
          Last used: {formatRelativeTime(agent.lastUsedAt)}
        </div>

        {agent.expiresAt && (
          <div className="text-sm text-gray-500">
            Expires: {new Date(agent.expiresAt).toLocaleDateString()}
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 flex gap-2">
        <button
          onClick={onEdit}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <Pencil className="w-4 h-4" />
          Edit
        </button>
        <button
          onClick={() => setShowRegenerateConfirm(true)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Regenerate
        </button>
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Agent</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete "{agent.name}"? This action cannot be undone and the
              token will stop working immediately.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  onDelete();
                }}
                className="btn bg-red-600 text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showRegenerateConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowRegenerateConfirm(false)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Regenerate Token</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to regenerate the token for "{agent.name}"? The current token
              will be invalidated immediately.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowRegenerateConfirm(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowRegenerateConfirm(false);
                  onRegenerate();
                }}
                className="btn btn-primary"
              >
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentSettings() {
  const { currentWorkspace } = useWorkspaceStore();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingAgent, setEditingAgent] = useState<WorkspaceAgent | null>(null);
  const [displayedToken, setDisplayedToken] = useState<string | null>(null);
  const [isRegeneratedToken, setIsRegeneratedToken] = useState(false);

  const workspaceId = currentWorkspace?.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ['workspace-agents', workspaceId],
    queryFn: () => workspaceAgentApi.list(workspaceId!),
    enabled: !!workspaceId,
  });

  const deleteMutation = useMutation({
    mutationFn: (agentId: string) => workspaceAgentApi.delete(workspaceId!, agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-agents', workspaceId] });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: (agentId: string) => workspaceAgentApi.regenerate(workspaceId!, agentId),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-agents', workspaceId] });
      setDisplayedToken(response.data.token);
      setIsRegeneratedToken(true);
    },
  });

  const handleCreateSuccess = (agentWithToken?: WorkspaceAgentWithToken) => {
    setShowCreateDialog(false);
    queryClient.invalidateQueries({ queryKey: ['workspace-agents', workspaceId] });
    if (agentWithToken?.token) {
      setDisplayedToken(agentWithToken.token);
      setIsRegeneratedToken(false);
    }
  };

  const handleEditSuccess = () => {
    setEditingAgent(null);
    queryClient.invalidateQueries({ queryKey: ['workspace-agents', workspaceId] });
  };

  if (!workspaceId) {
    return (
      <div className="card p-6">
        <p className="text-gray-600">Please select a workspace first.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-gray-200 rounded" />
          <div className="h-4 w-64 bg-gray-200 rounded" />
          <div className="h-32 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6">
        <div className="text-red-600">Failed to load agents: {(error as Error).message}</div>
      </div>
    );
  }

  const agents = data?.data?.agents || [];

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Workspace Agents</h2>
            <p className="text-sm text-gray-600 mt-1">
              Create API tokens for AI assistants to interact with FlowTask via MCP.
            </p>
          </div>
          <button onClick={() => setShowCreateDialog(true)} className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            New Agent
          </button>
        </div>

        {agents.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <Bot className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No agents yet</h3>
            <p className="text-gray-500 mb-4">
              Create your first agent to enable AI assistants to manage tasks.
            </p>
            <button onClick={() => setShowCreateDialog(true)} className="btn btn-primary">
              Create your first agent
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onEdit={() => setEditingAgent(agent)}
                onRegenerate={() => regenerateMutation.mutate(agent.id)}
                onDelete={() => deleteMutation.mutate(agent.id)}
              />
            ))}
          </div>
        )}
      </div>

      {showCreateDialog && (
        <AgentFormDialog
          workspaceId={workspaceId}
          onClose={() => setShowCreateDialog(false)}
          onSuccess={handleCreateSuccess}
        />
      )}

      {editingAgent && (
        <AgentFormDialog
          agent={editingAgent}
          workspaceId={workspaceId}
          onClose={() => setEditingAgent(null)}
          onSuccess={handleEditSuccess}
        />
      )}

      {displayedToken && (
        <TokenDisplayDialog
          token={displayedToken}
          isRegenerate={isRegeneratedToken}
          onClose={() => {
            setDisplayedToken(null);
            setIsRegeneratedToken(false);
          }}
        />
      )}
    </div>
  );
}
