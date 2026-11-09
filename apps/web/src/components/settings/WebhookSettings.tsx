/** Workspace settings → Outgoing webhooks (owner/admin). */
import { useState } from 'react';
import clsx from 'clsx';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
} from 'lucide-react';
import { OUTGOING_WEBHOOK_EVENTS, type OutgoingWebhookEvent } from '@flowtask/shared/types';
import { hasWebhookSecret } from '../../api/integrations';
import type {
  OutgoingWebhookDeliveryDto,
  OutgoingWebhookDto,
  OutgoingWebhookEventSelector,
} from '../../api/types';
import {
  useCurrentWorkspace,
  useWebhookDeliveries,
  useWebhookMutations,
  useWebhooks,
  useWorkspaceRole,
} from '../../hooks/queries';
import {
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  PageSpinner,
  Spinner,
  toast,
} from '../ui';

const EVENT_LABELS: Record<OutgoingWebhookEvent, string> = {
  'task.created': 'Task created',
  'task.updated': 'Task updated',
  'task.moved': 'Task moved',
  'task.deleted': 'Task deleted',
  'task.restored': 'Task restored',
  'comment.created': 'Comment added',
};

interface WebhookFormState {
  url: string;
  description: string;
  allEvents: boolean;
  events: OutgoingWebhookEvent[];
  enabled: boolean;
}

const EMPTY_FORM: WebhookFormState = {
  url: '',
  description: '',
  allEvents: true,
  events: [],
  enabled: true,
};

function isWebhookEvent(value: OutgoingWebhookEventSelector): value is OutgoingWebhookEvent {
  return value !== '*';
}

function formFromWebhook(webhook: OutgoingWebhookDto): WebhookFormState {
  const allEvents = webhook.events.includes('*');
  return {
    url: webhook.url,
    description: webhook.description ?? '',
    allEvents,
    events: allEvents ? [] : webhook.events.filter(isWebhookEvent),
    enabled: webhook.enabled,
  };
}

function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function describeEvents(events: OutgoingWebhookEventSelector[]): string {
  if (events.includes('*')) return 'All events';
  return events
    .filter(isWebhookEvent)
    .map((e) => EVENT_LABELS[e])
    .join(', ');
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

// ============ Form dialog ============

interface WebhookFormDialogProps {
  initial: WebhookFormState;
  isEdit: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (form: WebhookFormState) => void;
}

function WebhookFormDialog({
  initial,
  isEdit,
  isSaving,
  onClose,
  onSubmit,
}: WebhookFormDialogProps) {
  const [form, setForm] = useState<WebhookFormState>(initial);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidUrl(form.url.trim())) return setError('Enter a valid http(s) URL.');
    if (!form.allEvents && form.events.length === 0)
      return setError('Pick at least one event, or "All events".');
    setError(null);
    onSubmit({ ...form, url: form.url.trim(), description: form.description.trim() });
  };

  const toggleEvent = (event: OutgoingWebhookEvent) =>
    setForm((f) => ({
      ...f,
      events: f.events.includes(event) ? f.events.filter((e) => e !== event) : [...f.events, event],
    }));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={isEdit ? 'Edit webhook' : 'Add webhook'}
      description="FlowTask POSTs a signed JSON payload to this URL when the selected events happen."
      size="lg"
      dismissible={!isSaving}
    >
      <form onSubmit={submit} className="space-y-4" id="webhook-form">
        <div>
          <label htmlFor="webhook-url" className="mb-1 block text-sm font-medium text-gray-700">
            Payload URL
          </label>
          <input
            id="webhook-url"
            type="url"
            className="input"
            placeholder="https://example.com/hooks/flowtask"
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            required
          />
        </div>
        <div>
          <label
            htmlFor="webhook-description"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Description (optional)
          </label>
          <input
            id="webhook-description"
            className="input"
            maxLength={500}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700">Events</legend>
          <label className="mb-2 flex items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={form.allEvents}
              onChange={(e) => setForm((f) => ({ ...f, allEvents: e.target.checked }))}
            />
            All events (including ones added later)
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {OUTGOING_WEBHOOK_EVENTS.map((event) => (
              <label
                key={event}
                className={clsx(
                  'flex items-center gap-2 rounded border border-gray-200 px-2 py-1.5 text-sm',
                  form.allEvents ? 'text-gray-400' : 'text-gray-700'
                )}
              >
                <input
                  type="checkbox"
                  disabled={form.allEvents}
                  checked={form.allEvents || form.events.includes(event)}
                  onChange={() => toggleEvent(event)}
                />
                <span>{EVENT_LABELS[event]}</span>
                <code className="ml-auto text-[11px] text-gray-500">{event}</code>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          Active (deliver events)
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {isSaving && <Spinner size="sm" className="mr-2 text-current" label="Saving" />}
            {isEdit ? 'Save webhook' : 'Add webhook'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ============ Secret dialog ============

function SecretDialog({ secret, onClose }: { secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy; select the secret and copy it manually');
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Copy your signing secret"
      description="Use it to verify the X-FlowTask-Signature header of each delivery."
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          I have saved it
        </button>
      }
    >
      <p
        role="alert"
        className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
      >
        This is the only time the full secret is shown. Store it now; you can rotate it later but
        not read it again.
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
        <code className="flex-1 select-all break-all font-mono text-xs text-gray-900">
          {secret}
        </code>
        <IconButton
          label={copied ? 'Copied' : 'Copy secret'}
          icon={copied ? <Check className="text-green-600" /> : <Copy />}
          onClick={() => void copy()}
        />
      </div>
    </Dialog>
  );
}

// ============ Deliveries ============

const STATUS_STYLES: Record<OutgoingWebhookDeliveryDto['status'], string> = {
  success: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  pending: 'bg-amber-100 text-amber-800',
};

function Deliveries({ webhookId }: { webhookId: string }) {
  const {
    data: deliveries,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useWebhookDeliveries(webhookId);

  if (isLoading) return <Spinner label="Loading deliveries" className="m-3" />;
  if (error)
    return (
      <ErrorState
        error={error}
        resource="delivery log"
        onRetry={() => void refetch()}
        className="py-6"
      />
    );
  if (!deliveries || deliveries.length === 0) {
    return (
      <p className="p-3 text-sm text-gray-500">
        No deliveries yet. Send a test to check the endpoint.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex justify-end px-3 pt-2">
        <IconButton
          label="Refresh deliveries"
          icon={<RefreshCw className={clsx(isFetching && 'animate-spin')} />}
          onClick={() => void refetch()}
        />
      </div>
      <table className="w-full text-left text-xs">
        <caption className="sr-only">Recent deliveries</caption>
        <thead className="text-gray-500">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Event
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Response
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Duration
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Attempt
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Time
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {deliveries.map((d) => (
            <tr key={d.id} className="align-top">
              <td className="px-3 py-2 font-mono text-gray-800">{d.event}</td>
              <td className="px-3 py-2">
                <span
                  className={clsx(
                    'rounded-full px-2 py-0.5 font-medium capitalize',
                    STATUS_STYLES[d.status]
                  )}
                >
                  {d.status}
                </span>
                {d.error && <div className="mt-1 max-w-xs break-words text-red-700">{d.error}</div>}
              </td>
              <td className="px-3 py-2 text-gray-700">{d.responseCode ?? '—'}</td>
              <td className="px-3 py-2 text-gray-700">
                {d.durationMs !== null ? `${d.durationMs} ms` : '—'}
              </td>
              <td className="px-3 py-2 text-gray-700">{d.attempt}</td>
              <td className="px-3 py-2 text-gray-700">
                {formatTime(d.deliveredAt ?? d.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============ Row ============

interface WebhookRowProps {
  webhook: OutgoingWebhookDto;
  onEdit: () => void;
  onDelete: () => void;
  onRotate: () => void;
  onToggle: () => void;
  onTest: () => void;
  isTesting: boolean;
}

function WebhookRow({
  webhook,
  onEdit,
  onDelete,
  onRotate,
  onToggle,
  onTest,
  isTesting,
}: WebhookRowProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = `deliveries-${webhook.id}`;
  return (
    <li className="rounded-lg border border-gray-200">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm text-gray-900">{webhook.url}</span>
            <span
              className={clsx(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                webhook.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
              )}
            >
              {webhook.enabled ? 'Active' : 'Disabled'}
            </span>
          </div>
          {webhook.description && (
            <p className="mt-1 text-sm text-gray-600">{webhook.description}</p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            {describeEvents(webhook.events)} · secret{' '}
            <code className="font-mono">{webhook.secretPreview}</code>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <label className="mr-2 flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={webhook.enabled} onChange={onToggle} />
            Enabled
          </label>
          <button
            type="button"
            className="btn btn-secondary !px-2 !py-1 text-xs"
            onClick={onTest}
            disabled={isTesting}
          >
            <Send aria-hidden className="mr-1 h-3.5 w-3.5" />
            {isTesting ? 'Sending…' : 'Send test'}
          </button>
          <IconButton label="Edit webhook" icon={<Pencil />} onClick={onEdit} />
          <IconButton label="Rotate secret" icon={<RefreshCw />} onClick={onRotate} />
          <IconButton
            label="Delete webhook"
            variant="danger"
            icon={<Trash2 />}
            onClick={onDelete}
          />
        </div>
      </div>
      <button
        type="button"
        className="flex w-full items-center gap-1 border-t border-gray-100 px-4 py-2 text-left text-xs font-medium text-gray-600 hover:bg-gray-50"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown aria-hidden className="h-4 w-4" />
        ) : (
          <ChevronRight aria-hidden className="h-4 w-4" />
        )}
        Recent deliveries
      </button>
      {expanded && (
        <div id={panelId} className="border-t border-gray-100">
          <Deliveries webhookId={webhook.id} />
        </div>
      )}
    </li>
  );
}

// ============ Tab ============

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; webhook: OutgoingWebhookDto }
  | { kind: 'delete'; webhook: OutgoingWebhookDto }
  | { kind: 'rotate'; webhook: OutgoingWebhookDto }
  | null;

function eventsFromForm(form: WebhookFormState): OutgoingWebhookEventSelector[] {
  return form.allEvents ? ['*'] : form.events;
}

export function WebhookSettings() {
  const { workspace } = useCurrentWorkspace();
  const workspaceId = workspace?.id ?? '';
  const { data: role, isLoading: roleLoading } = useWorkspaceRole(workspace?.id);
  const canManage = role === 'owner' || role === 'admin';
  const {
    data: webhooks = [],
    isLoading,
    error,
    refetch,
  } = useWebhooks(canManage ? workspace?.id : null);
  const mutations = useWebhookMutations(workspaceId);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [secret, setSecret] = useState<string | null>(null);

  if (!workspace || roleLoading) return <PageSpinner />;
  if (!canManage) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Outgoing webhooks</h2>
        <p className="text-gray-600">Only workspace owners and admins can manage webhooks.</p>
      </div>
    );
  }

  const handleSubmit = (form: WebhookFormState) => {
    if (dialog?.kind === 'edit') {
      mutations.update.mutate(
        {
          id: dialog.webhook.id,
          url: form.url,
          description: form.description || null,
          events: eventsFromForm(form),
          enabled: form.enabled,
        },
        {
          onSuccess: () => {
            setDialog(null);
            toast.success('Webhook saved');
          },
        }
      );
      return;
    }
    mutations.create.mutate(
      {
        url: form.url,
        description: form.description || undefined,
        events: eventsFromForm(form),
        enabled: form.enabled,
      },
      {
        onSuccess: (created) => {
          setDialog(null);
          setSecret(created.secret);
          toast.success('Webhook added');
        },
      }
    );
  };

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Outgoing webhooks</h2>
          <p className="mt-1 text-sm text-gray-600">
            Send task and comment events from {workspace.name} to your own services (Slack, Zapier,
            CI, …).
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setDialog({ kind: 'create' })}
        >
          Add webhook
        </button>
      </div>

      {error ? (
        <ErrorState error={error} resource="webhook list" onRetry={() => void refetch()} />
      ) : isLoading ? (
        <PageSpinner className="h-32" />
      ) : webhooks.length === 0 ? (
        <EmptyState
          icon={<Webhook />}
          title="No webhooks yet"
          body="Add a URL to receive a signed POST for every task or comment event."
          action={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDialog({ kind: 'create' })}
            >
              Add webhook
            </button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {webhooks.map((webhook) => (
            <WebhookRow
              key={webhook.id}
              webhook={webhook}
              onEdit={() => setDialog({ kind: 'edit', webhook })}
              onDelete={() => setDialog({ kind: 'delete', webhook })}
              onRotate={() => setDialog({ kind: 'rotate', webhook })}
              onToggle={() =>
                mutations.update.mutate(
                  { id: webhook.id, enabled: !webhook.enabled },
                  {
                    onSuccess: () =>
                      toast.success(webhook.enabled ? 'Webhook disabled' : 'Webhook enabled'),
                  }
                )
              }
              onTest={() =>
                mutations.test.mutate(webhook.id, {
                  onSuccess: () => toast.success('Test delivery queued'),
                })
              }
              isTesting={mutations.test.isPending && mutations.test.variables === webhook.id}
            />
          ))}
        </ul>
      )}

      {(dialog?.kind === 'create' || dialog?.kind === 'edit') && (
        <WebhookFormDialog
          initial={dialog.kind === 'edit' ? formFromWebhook(dialog.webhook) : EMPTY_FORM}
          isEdit={dialog.kind === 'edit'}
          isSaving={mutations.create.isPending || mutations.update.isPending}
          onClose={() => setDialog(null)}
          onSubmit={handleSubmit}
        />
      )}

      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="Delete this webhook?"
        description={
          dialog?.kind === 'delete'
            ? `${dialog.webhook.url} stops receiving events. Its delivery log is deleted too.`
            : undefined
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (dialog?.kind !== 'delete') return;
          await mutations.remove.mutateAsync(dialog.webhook.id);
          toast.success('Webhook deleted');
        }}
      />

      <ConfirmDialog
        open={dialog?.kind === 'rotate'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="Rotate the signing secret?"
        description="The current secret stops working immediately; update your receiver with the new one."
        confirmLabel="Rotate secret"
        variant="danger"
        onConfirm={async () => {
          if (dialog?.kind !== 'rotate') return;
          const updated = await mutations.update.mutateAsync({
            id: dialog.webhook.id,
            rotateSecret: true,
          });
          if (hasWebhookSecret(updated)) setSecret(updated.secret);
        }}
      />

      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </div>
  );
}
