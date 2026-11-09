import { useMemo, useState } from 'react';
import { Bot, Copy, Check, Pencil, Trash2, Shield, Link2 } from 'lucide-react';
import clsx from 'clsx';
import type { McpOAuthConnection } from '../../api/workspaces';
import {
  useCurrentWorkspace,
  useMcpConnectionMutations,
  useMcpConnections,
} from '../../hooks/queries';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  Panel,
  toast,
} from '../ui';
import { AVAILABLE_PERMISSIONS } from '../../lib/agent-tools';

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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Edit MCP tool scopes"
      description={`${connection.clientName} (${connection.clientId})`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Scopes'}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className="mb-3 p-2 text-sm text-red-600 bg-red-50 rounded">
          {error}
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className="sr-only">Tool scopes</legend>
        {AVAILABLE_PERMISSIONS.map((permission) => (
          <label
            key={permission.id}
            className={clsx(
              'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
              toolScopes.includes(permission.id)
                ? 'border-primary-500 bg-primary-50'
                : 'border-neutral-200 hover:bg-neutral-50'
            )}
          >
            <Checkbox
              checked={toolScopes.includes(permission.id)}
              onChange={() => toggleScope(permission.id)}
            />
            <span className="text-sm text-neutral-900">{permission.label}</span>
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
}

interface ConnectionCardProps {
  connection: McpOAuthConnection;
  onEditScopes: () => void;
  onDelete: () => Promise<void>;
}

function ConnectionCard({ connection, onEditScopes, onDelete }: ConnectionCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <Panel className="bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary-100">
            <Bot className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h3 className="font-medium text-neutral-900">{connection.clientName}</h3>
            <p className="text-xs text-neutral-500 font-mono">{connection.clientId}</p>
          </div>
        </div>
        <Badge tone="success" shape="pill">
          Connected
        </Badge>
      </div>

      <div className="mt-4 space-y-2 text-sm text-neutral-600">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-neutral-400" />
          <span>
            {connection.toolScopes.length} scope{connection.toolScopes.length === 1 ? '' : 's'}:{' '}
            {connection.toolScopes.join(', ')}
          </span>
        </div>
        <div>
          Authorized by:{' '}
          <span className="text-neutral-900">
            {connection.grantedBy.name || connection.grantedBy.email}
          </span>{' '}
          ({connection.grantedByRole})
        </div>
        <div>Updated: {formatRelativeTime(connection.updatedAt)}</div>
        <div>Last activity: {formatRelativeTime(connection.lastActivityAt)}</div>
      </div>

      <div className="mt-4 pt-4 border-t border-neutral-100 flex gap-2">
        <Button variant="ghost" size="sm" leadingIcon={<Pencil />} onClick={onEditScopes}>
          Edit Scopes
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<Trash2 />}
          className="text-red-600 hover:bg-red-50"
          onClick={() => setShowDeleteConfirm(true)}
        >
          Delete
        </Button>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete OAuth connection"
        description={`Permanently delete ${connection.clientName}? All OAuth tokens will be revoked and the connection record will be removed.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={onDelete}
      />
    </Panel>
  );
}

function ConnectGuide() {
  const [copied, setCopied] = useState<string | null>(null);
  const origin = window.location.origin;

  const values = useMemo(
    () => ({
      mcpUrl: `${origin}/api/mcp`,
      protectedResource: `${origin}/.well-known/oauth-protected-resource/api/mcp`,
      authServer: `${origin}/api/mcp/.well-known/oauth-authorization-server`,
    }),
    [origin]
  );
  const claudeCodeCommand = useMemo(
    () => `claude mcp add --transport http [CustomeTokenName] ${values.mcpUrl}`,
    [values.mcpUrl]
  );

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      toast.error('Could not copy to the clipboard');
      return;
    }
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Card title="How to connect ChatGPT / Claude" icon={<Link2 className="text-primary-600" />}>
      <ul className="list-disc pl-5 text-sm text-neutral-700 space-y-1 mb-4">
        <li>
          Add this MCP server URL in your client: <code className="font-mono">{values.mcpUrl}</code>
        </li>
        <li>
          For Claude Code, run the command below, then run <code className="font-mono">/mcp</code>{' '}
          and authorize.
        </li>
        <li>OAuth discovery is automatic using the well-known endpoints below.</li>
        <li>Approve workspace + tool scopes during OAuth consent.</li>
        <li>Only workspace owners/admins can authorize MCP access.</li>
      </ul>

      <div className="mb-4 p-2 bg-neutral-50 rounded border border-neutral-200">
        <div className="text-xs text-neutral-600 mb-1">Claude Code command</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-neutral-800 break-all">
            {claudeCodeCommand}
          </code>
          <IconButton
            label={copied === 'claude-cli' ? 'Copied' : 'Copy command'}
            onClick={() => void copy('claude-cli', claudeCodeCommand)}
            icon={copied === 'claude-cli' ? <Check className="text-green-600" /> : <Copy />}
          />
        </div>
      </div>

      <div className="space-y-2">
        {[
          { key: 'mcp', label: 'MCP Server URL', value: values.mcpUrl },
          { key: 'pr', label: 'Protected Resource Metadata', value: values.protectedResource },
          { key: 'as', label: 'Authorization Server Metadata', value: values.authServer },
        ].map((item) => (
          <div
            key={item.key}
            className="flex items-center gap-2 p-2 bg-neutral-50 rounded border border-neutral-200"
          >
            <div className="min-w-44 text-xs text-neutral-600">{item.label}</div>
            <code className="flex-1 text-xs font-mono text-neutral-800 break-all">
              {item.value}
            </code>
            <IconButton
              label={copied === item.key ? 'Copied' : `Copy ${item.label}`}
              onClick={() => void copy(item.key, item.value)}
              icon={copied === item.key ? <Check className="text-green-600" /> : <Copy />}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function AgentSettings() {
  const { workspace: currentWorkspace } = useCurrentWorkspace();
  const [editingConnection, setEditingConnection] = useState<McpOAuthConnection | null>(null);
  const workspaceId = currentWorkspace?.id;

  const { data, isLoading, error, refetch } = useMcpConnections(workspaceId);
  const { updateScopes: updateScopesMutation, remove: deleteMutation } = useMcpConnectionMutations(
    workspaceId ?? ''
  );

  if (!workspaceId) {
    return (
      <Card>
        <p className="text-neutral-600">Please select a workspace first.</p>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-neutral-200 rounded" />
          <div className="h-4 w-64 bg-neutral-200 rounded" />
          <div className="h-32 bg-neutral-100 rounded" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <ErrorState error={error} resource="list of connections" onRetry={() => void refetch()} />
      </Card>
    );
  }

  const connections = data ?? [];

  return (
    <div className="space-y-6">
      <ConnectGuide />

      <Card
        title="MCP OAuth Connections"
        description="Manage workspace-wide OAuth connections authorized for MCP access."
      >
        {connections.length === 0 ? (
          <EmptyState
            icon={<Bot />}
            title="No OAuth connections yet"
            body="Authorize the MCP server from ChatGPT or Claude to create the first connection."
          />
        ) : (
          <div className="space-y-4">
            {connections.map((connection) => (
              <ConnectionCard
                key={connection.consentId}
                connection={connection}
                onEditScopes={() => setEditingConnection(connection)}
                onDelete={async () => {
                  await deleteMutation.mutateAsync(connection.consentId);
                  toast.success('Connection deleted');
                }}
              />
            ))}
          </div>
        )}
      </Card>

      {editingConnection && (
        <ScopeEditorDialog
          connection={editingConnection}
          onClose={() => setEditingConnection(null)}
          onSave={(toolScopes) =>
            updateScopesMutation.mutate(
              { consentId: editingConnection.consentId, toolScopes },
              {
                onSuccess: () => {
                  setEditingConnection(null);
                  toast.success('Scopes updated');
                },
              }
            )
          }
          isSaving={updateScopesMutation.isPending}
        />
      )}
    </div>
  );
}
