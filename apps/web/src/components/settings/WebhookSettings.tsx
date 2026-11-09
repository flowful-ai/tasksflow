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
  Badge,
  type BadgeTone,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
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
        <Field label="Payload URL" id="webhook-url">
          <Input
            type="url"
            placeholder="https://example.com/hooks/flowtask"
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            required
          />
        </Field>
        <Field label="Description (optional)" id="webhook-description">
          <Input
            maxLength={500}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-neutral-700">Events</legend>
          <Checkbox
            labelClassName="mb-2"
            label="All events (including ones added later)"
            checked={form.allEvents}
            onChange={(e) => setForm((f) => ({ ...f, allEvents: e.target.checked }))}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {OUTGOING_WEBHOOK_EVENTS.map((event) => (
              <label
                key={event}
                className={clsx(
                  'flex items-center gap-2 rounded border border-neutral-200 px-2 py-1.5 text-sm',
                  form.allEvents ? 'text-neutral-400' : 'text-neutral-700'
                )}
              >
                <Checkbox
                  disabled={form.allEvents}
                  checked={form.allEvents || form.events.includes(event)}
                  onChange={() => toggleEvent(event)}
                />
                <span>{EVENT_LABELS[event]}</span>
                <code className="ml-auto text-[11px] text-neutral-500">{event}</code>
              </label>
            ))}
          </div>
        </fieldset>
        <Checkbox
          label="Active (deliver events)"
          checked={form.enabled}
          onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
        />
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" loading={isSaving}>
            {isEdit ? 'Save webhook' : 'Add webhook'}
          </Button>
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
      footer={<Button onClick={onClose}>I have saved it</Button>}
    >
      <p
        role="alert"
        className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
      >
        This is the only time the full secret is shown. Store it now; you can rotate it later but
        not read it again.
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
        <code className="flex-1 select-all break-all font-mono text-xs text-neutral-900">
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

const STATUS_TONES: Record<OutgoingWebhookDeliveryDto['status'], BadgeTone> = {
  success: 'success',
  failed: 'danger',
  pending: 'warning',
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
      <p className="p-3 text-sm text-neutral-500">
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
        <thead className="text-neutral-500">
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
        <tbody className="divide-y divide-neutral-100">
          {deliveries.map((d) => (
            <tr key={d.id} className="align-top">
              <td className="px-3 py-2 font-mono text-neutral-800">{d.event}</td>
              <td className="px-3 py-2">
                <Badge shape="pill" tone={STATUS_TONES[d.status]} className="capitalize">
                  {d.status}
                </Badge>
                {d.error && <div className="mt-1 max-w-xs break-words text-red-700">{d.error}</div>}
              </td>
              <td className="px-3 py-2 text-neutral-700">{d.responseCode ?? '—'}</td>
              <td className="px-3 py-2 text-neutral-700">
                {d.durationMs !== null ? `${d.durationMs} ms` : '—'}
              </td>
              <td className="px-3 py-2 text-neutral-700">{d.attempt}</td>
              <td className="px-3 py-2 text-neutral-700">
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
    <li className="rounded-lg border border-neutral-200">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm text-neutral-900">{webhook.url}</span>
            <Badge shape="pill" tone={webhook.enabled ? 'success' : 'neutral'}>
              {webhook.enabled ? 'Active' : 'Disabled'}
            </Badge>
          </div>
          {webhook.description && (
            <p className="mt-1 text-sm text-neutral-600">{webhook.description}</p>
          )}
          <p className="mt-1 text-xs text-neutral-500">
            {describeEvents(webhook.events)} · secret{' '}
            <code className="font-mono">{webhook.secretPreview}</code>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <label className="mr-2 flex items-center gap-1.5 text-xs text-neutral-600">
            <Checkbox checked={webhook.enabled} onChange={onToggle} />
            Enabled
          </label>
          <Button
            variant="secondary"
            size="xs"
            leadingIcon={<Send />}
            onClick={onTest}
            disabled={isTesting}
          >
            {isTesting ? 'Sending…' : 'Send test'}
          </Button>
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
        className="flex w-full items-center gap-1 border-t border-neutral-100 px-4 py-2 text-left text-xs font-medium text-neutral-600 hover:bg-neutral-50"
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
        <div id={panelId} className="border-t border-neutral-100">
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
      <Card title="Outgoing webhooks">
        <p className="text-neutral-600">Only workspace owners and admins can manage webhooks.</p>
      </Card>
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
    <Card
      title="Outgoing webhooks"
      description={`Send task and comment events from ${workspace.name} to your own services (Slack, Zapier, CI, …).`}
      actions={<Button onClick={() => setDialog({ kind: 'create' })}>Add webhook</Button>}
    >
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
            <Button variant="secondary" onClick={() => setDialog({ kind: 'create' })}>
              Add webhook
            </Button>
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
    </Card>
  );
}
