import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Copy, Check, Pencil, Trash2, Shield, Link2 } from 'lucide-react';
import clsx from 'clsx';
import { useWorkspaceStore } from '../../stores/workspace';
import { mcpConnectionApi, type McpOAuthConnection } from '../../api/client';

const AVAILABLE_PERMISSIONS = [
  { id: 'create_task', label: 'Create tasks' },
  { id: 'update_task', label: 'Update tasks' },
  { id: 'delete_task', label: 'Delete tasks' },
  { id: 'query_tasks', label: 'Query tasks' },
  { id: 'move_task', label: 'Move tasks' },
  { id: 'assign_task', label: 'Assign tasks' },
  { id: 'add_comment', label: 'Add comments' },
  { id: 'summarize_project', label: 'Summarize project' },
  { id: 'create_smart_view', label: 'Create smart views' },
  { id: 'search_tasks', label: 'Search tasks' },
  { id: 'list_projects', label: 'List projects' },
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

interface ScopeEditorDialogProps {
  connection: McpOAuthConnection;
  onClose: () => void;
  onSave: (toolScopes: string[]) => void;
  isSaving: boolean;
}

function ScopeEditorDialog({ connection, onClose, onSave, isSaving }: ScopeEditorDialogProps) {
  const [toolScopes, setToolScopes] = useState<string[]>(connection.toolScopes);
  const [error, setError] = useState<string | null>(null);

  const toggleScope = (scopeId: string) => {
    setToolScopes((prev) =>
      prev.includes(scopeId) ? prev.filter((id) => id !== scopeId) : [...prev, scopeId]
    );
  };

  const handleSave = () => {
    if (toolScopes.length === 0) {
      setError('Select at least one permission.');
      return;
    }

    setError(null);
    onSave(toolScopes);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-lg shadow-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Edit MCP Tool Scopes</h3>
        <p className="text-sm text-gray-600 mb-4">
          {connection.clientName} ({connection.clientId})
        </p>

        {error && <div className="mb-3 p-2 text-sm text-red-600 bg-red-50 rounded">{error}</div>}

        <div className="max-h-72 overflow-y-auto space-y-2">
          {AVAILABLE_PERMISSIONS.map((permission) => (
            <label
              key={permission.id}
              className={clsx(
                'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                toolScopes.includes(permission.id)
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:bg-gray-50'
              )}
            >
              <input
                type="checkbox"
                checked={toolScopes.includes(permission.id)}
                onChange={() => toggleScope(permission.id)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-900">{permission.label}</span>
            </label>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Scopes'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConnectionCardProps {
  connection: McpOAuthConnection;
  onEditScopes: () => void;
  onDisconnect: () => void;
}

function ConnectionCard({ connection, onEditScopes, onDisconnect }: ConnectionCardProps) {
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  return (
    <div className={clsx('p-4 border rounded-lg', connection.revokedAt ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center', connection.revokedAt ? 'bg-gray-200' : 'bg-primary-100')}>
            <Bot className={clsx('w-5 h-5', connection.revokedAt ? 'text-gray-500' : 'text-primary-600')} />
          </div>
          <div>
            <h3 className="font-medium text-gray-900">{connection.clientName}</h3>
            <p className="text-xs text-gray-500 font-mono">{connection.clientId}</p>
          </div>
        </div>
        <span
          className={clsx(
            'px-2 py-1 text-xs font-medium rounded-full',
            connection.revokedAt ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'
          )}
        >
          {connection.revokedAt ? 'Disconnected' : 'Connected'}
        </span>
      </div>

      <div className="mt-4 space-y-2 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-gray-400" />
          <span>
            {connection.toolScopes.length} scope{connection.toolScopes.length === 1 ? '' : 's'}: {connection.toolScopes.join(', ')}
          </span>
        </div>
        <div>
          Authorized by: <span className="text-gray-900">{connection.grantedBy.name || connection.grantedBy.email}</span> ({connection.grantedByRole})
        </div>
        <div>Updated: {formatRelativeTime(connection.updatedAt)}</div>
        <div>Last activity: {formatRelativeTime(connection.lastActivityAt)}</div>
      </div>

      {!connection.revokedAt && (
        <div className="mt-4 pt-4 border-t border-gray-100 flex gap-2">
          <button onClick={onEditScopes} className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
            <Pencil className="w-4 h-4" />
            Edit Scopes
          </button>
          <button
            onClick={() => setShowDisconnectConfirm(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Disconnect
          </button>
        </div>
      )}

      {showDisconnectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowDisconnectConfirm(false)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Disconnect OAuth Connection</h3>
            <p className="text-sm text-gray-600 mb-4">
              Disconnect {connection.clientName}? Existing OAuth tokens will be revoked immediately.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowDisconnectConfirm(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDisconnectConfirm(false);
                  onDisconnect();
                }}
                className="btn bg-red-600 text-white hover:bg-red-700"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectGuide() {
  const [copied, setCopied] = useState<string | null>(null);
  const origin = window.location.origin;

  const values = useMemo(
    () => ({
      mcpUrl: `${origin}/api/mcp/sse`,
      protectedResource: `${origin}/.well-known/oauth-protected-resource/api/mcp/sse`,
      authServer: `${origin}/api/mcp/.well-known/oauth-authorization-server`,
    }),
    [origin]
  );

  const copy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="w-5 h-5 text-primary-600" />
        <h2 className="text-lg font-semibold text-gray-900">How to connect ChatGPT / Claude</h2>
      </div>

      <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1 mb-4">
        <li>Add this MCP server URL in your client: <code className="font-mono">{values.mcpUrl}</code></li>
        <li>OAuth discovery is automatic using the well-known endpoints below.</li>
        <li>Approve workspace + tool scopes during OAuth consent.</li>
        <li>Only workspace owners/admins can authorize MCP access.</li>
      </ul>

      <div className="space-y-2">
        {[
          { key: 'mcp', label: 'MCP Server URL', value: values.mcpUrl },
          { key: 'pr', label: 'Protected Resource Metadata', value: values.protectedResource },
          { key: 'as', label: 'Authorization Server Metadata', value: values.authServer },
        ].map((item) => (
          <div key={item.key} className="flex items-center gap-2 p-2 bg-gray-50 rounded border border-gray-200">
            <div className="min-w-44 text-xs text-gray-600">{item.label}</div>
            <code className="flex-1 text-xs font-mono text-gray-800 break-all">{item.value}</code>
            <button
              onClick={() => copy(item.key, item.value)}
              className="p-1.5 rounded hover:bg-gray-200"
              title="Copy"
            >
              {copied === item.key ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-gray-500" />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentSettings() {
  const { currentWorkspace } = useWorkspaceStore();
  const queryClient = useQueryClient();
  const [editingConnection, setEditingConnection] = useState<McpOAuthConnection | null>(null);
  const workspaceId = currentWorkspace?.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ['mcp-connections', workspaceId],
    queryFn: () => mcpConnectionApi.list(workspaceId!),
    enabled: !!workspaceId,
  });

  const updateScopesMutation = useMutation({
    mutationFn: ({ consentId, toolScopes }: { consentId: string; toolScopes: string[] }) =>
      mcpConnectionApi.updateScopes(workspaceId!, consentId, toolScopes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-connections', workspaceId] });
      setEditingConnection(null);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (consentId: string) => mcpConnectionApi.revoke(workspaceId!, consentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-connections', workspaceId] });
    },
  });

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
        <div className="text-red-600">Failed to load OAuth connections: {(error as Error).message}</div>
      </div>
    );
  }

  const connections = data?.data.connections || [];

  return (
    <div className="space-y-6">
      <ConnectGuide />

      <div className="card p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">MCP OAuth Connections</h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage workspace-wide OAuth connections authorized for MCP access.
          </p>
        </div>

        {connections.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-14 h-14 mx-auto bg-gray-100 rounded-full flex items-center justify-center mb-3">
              <Bot className="w-7 h-7 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No OAuth connections yet</h3>
            <p className="text-gray-500">Authorize the MCP server from ChatGPT or Claude to create the first connection.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {connections.map((connection) => (
              <ConnectionCard
                key={connection.consentId}
                connection={connection}
                onEditScopes={() => setEditingConnection(connection)}
                onDisconnect={() => revokeMutation.mutate(connection.consentId)}
              />
            ))}
          </div>
        )}
      </div>

      {editingConnection && (
        <ScopeEditorDialog
          connection={editingConnection}
          onClose={() => setEditingConnection(null)}
          onSave={(toolScopes) =>
            updateScopesMutation.mutate({
              consentId: editingConnection.consentId,
              toolScopes,
            })
          }
          isSaving={updateScopesMutation.isPending}
        />
      )}
    </div>
  );
}
