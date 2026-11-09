import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { SlackNotificationSettings } from '@flowtask/shared';
import { slackApi } from '../../api/integrations';
import { useSlackChannels, useSlackIntegration, useSlackMutations } from '../../hooks/queries';
import { Banner, ConfirmDialog, ErrorState, PageSpinner, toast } from '../ui';

const NOTIFICATION_LABELS: Array<{ key: keyof SlackNotificationSettings; label: string }> = [
  { key: 'taskCreated', label: 'Task created' },
  { key: 'stateChanged', label: 'Task moved / completed' },
  { key: 'assigned', label: 'Task assigned' },
  { key: 'commentAdded', label: 'Comment added' },
];

/** `slack_error` codes set by GET /api/webhooks/slack/oauth when it redirects back here. */
const SLACK_ERROR_MESSAGES: Record<string, string> = {
  invalid_state: 'The Slack link expired or was already used. Please try again.',
  session_mismatch: 'Slack was connected from a different session. Please try again.',
  forbidden: 'You need admin access to this project to connect Slack.',
  not_configured: 'Slack is not configured on the server.',
  no_channel: 'Pick a channel in the Slack dialog.',
  oauth_failed: 'Slack authorization failed.',
  access_denied: 'Slack authorization was cancelled.',
};

interface SlackSettingsProps {
  projectId: string;
}

/** Project Slack notifications (FlowTask → Slack, one-way). */
export function SlackSettings({ projectId }: SlackSettingsProps) {
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const { data: slack, isLoading, error, refetch } = useSlackIntegration(projectId);
  const {
    data: channels,
    isLoading: channelsLoading,
    error: channelsError,
  } = useSlackChannels(projectId, Boolean(slack?.connected));
  const { update, disconnect } = useSlackMutations(projectId);

  // The OAuth callback lands here with ?slack=connected or ?slack_error=<code>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slackError = params.get('slack_error');
    const connected = params.get('slack');
    if (!slackError && !connected) return;
    window.history.replaceState({}, '', window.location.pathname);
    if (slackError)
      setCallbackError(SLACK_ERROR_MESSAGES[slackError] ?? 'Slack connection failed.');
    else toast.success('Slack connected');
    void refetch();
  }, [refetch]);

  const connect = async () => {
    setIsStarting(true);
    try {
      const { url } = await slackApi.startInstall(projectId);
      window.location.href = url;
    } catch (err) {
      setIsStarting(false);
      toast.error(err instanceof Error ? err.message : 'Failed to start Slack connection');
    }
  };

  if (isLoading) {
    return (
      <div className="card p-6">
        <PageSpinner className="h-32" label="Loading Slack settings" />
      </div>
    );
  }

  if (error || !slack) {
    return (
      <div className="card p-6">
        <ErrorState error={error} resource="Slack settings" onRetry={() => void refetch()} />
      </div>
    );
  }

  const notifications = slack.notifications;

  return (
    <div className="card p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Slack Notifications</h2>
        <p className="text-sm text-gray-500 mt-1">
          Post task activity from this project to a Slack channel.
        </p>
      </div>

      {callbackError && <Banner variant="error">{callbackError}</Banner>}

      {!slack.connected ? (
        slack.canConnect ? (
          <button
            type="button"
            onClick={() => void connect()}
            className="btn btn-primary"
            disabled={isStarting}
          >
            {isStarting ? 'Redirecting to Slack…' : 'Connect Slack'}
          </button>
        ) : (
          <Banner variant="warning">
            Slack is not configured. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and
            SLACK_SIGNING_SECRET on the server.
          </Banner>
        )
      ) : (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm text-gray-700">
            <CheckCircle2 aria-hidden className="w-4 h-4 text-green-600" />
            Connected to {slack.teamName ?? 'Slack'}
            {slack.channelName ? <>, posting to #{slack.channelName}</> : null}
          </p>

          <div className="text-sm">
            <label htmlFor="slack-channel" className="text-gray-700">
              Channel
            </label>
            <select
              id="slack-channel"
              className="input mt-1"
              value={slack.channelId ?? ''}
              onChange={(e) =>
                update.mutate(
                  { channelId: e.target.value },
                  {
                    onSuccess: (view) =>
                      toast.success(`Posting to #${view.channelName ?? 'channel'}`),
                  }
                )
              }
              disabled={update.isPending || channelsLoading || !channels}
              aria-describedby={channelsError ? 'slack-channel-error' : undefined}
            >
              {slack.channelId && !channels?.some((ch) => ch.id === slack.channelId) && (
                <option value={slack.channelId}>#{slack.channelName}</option>
              )}
              {channels?.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.isPrivate ? '🔒 ' : '#'}
                  {ch.name}
                </option>
              ))}
            </select>
            {channelsError && (
              <p id="slack-channel-error" className="mt-1 text-xs text-red-600">
                Could not list channels: {channelsError.message}
              </p>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm text-gray-700 mb-1">Notify on</legend>
            {NOTIFICATION_LABELS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={notifications?.[key] ?? true}
                  onChange={(e) => update.mutate({ notifications: { [key]: e.target.checked } })}
                  disabled={update.isPending}
                />
                {label}
              </label>
            ))}
          </fieldset>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={slack.isEnabled}
                onChange={(e) =>
                  update.mutate(
                    { isEnabled: e.target.checked },
                    {
                      onSuccess: (view) =>
                        toast.success(
                          view.isEnabled ? 'Slack notifications on' : 'Slack notifications paused'
                        ),
                    }
                  )
                }
                disabled={update.isPending}
              />
              Enabled
            </label>
            <button
              type="button"
              onClick={() => setConfirmDisconnect(true)}
              className="btn btn-secondary ml-auto"
              disabled={disconnect.isPending}
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Slack?"
        description="This project stops posting to Slack and the stored bot token is deleted."
        confirmLabel="Disconnect"
        variant="danger"
        onConfirm={async () => {
          await disconnect.mutateAsync();
          toast.success('Slack disconnected');
        }}
      />
    </div>
  );
}
