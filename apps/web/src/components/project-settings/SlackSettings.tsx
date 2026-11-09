import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { api } from '../../api/client';

interface SlackNotificationSettings {
  taskCreated: boolean;
  stateChanged: boolean;
  assigned: boolean;
  commentAdded: boolean;
}

interface SlackIntegrationView {
  connected: boolean;
  id: string | null;
  isEnabled: boolean;
  teamName: string | null;
  channelId: string | null;
  channelName: string | null;
  notifications: SlackNotificationSettings | null;
  canConnect: boolean;
}

interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

const NOTIFICATION_LABELS: Array<{ key: keyof SlackNotificationSettings; label: string }> = [
  { key: 'taskCreated', label: 'Task created' },
  { key: 'stateChanged', label: 'Task moved / completed' },
  { key: 'assigned', label: 'Task assigned' },
  { key: 'commentAdded', label: 'Comment added' },
];

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
  const [error, setError] = useState<string | null>(null);

  const { data: slack, isLoading, refetch } = useQuery({
    queryKey: ['slack-integration', projectId],
    queryFn: async () =>
      (await api.get<{ success: boolean; data: SlackIntegrationView }>(`/api/projects/${projectId}/slack`)).data,
  });

  const { data: channels } = useQuery({
    queryKey: ['slack-channels', projectId],
    queryFn: async () =>
      (await api.get<{ success: boolean; data: { channels: SlackChannel[] } }>(`/api/projects/${projectId}/slack/channels`))
        .data.channels,
    enabled: Boolean(slack?.connected),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slackError = params.get('slack_error');
    if (slackError || params.get('slack')) {
      window.history.replaceState({}, '', window.location.pathname);
      if (slackError) setError(SLACK_ERROR_MESSAGES[slackError] ?? 'Slack connection failed.');
      refetch();
    }
  }, [refetch]);

  const connect = async () => {
    try {
      const response = await api.post<{ success: boolean; data: { url: string } }>(
        `/api/projects/${projectId}/slack/install/start`
      );
      window.location.href = response.data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Slack connection');
    }
  };

  const update = useMutation({
    mutationFn: (patch: { channelId?: string; isEnabled?: boolean; notifications?: Partial<SlackNotificationSettings> }) =>
      api.patch<{ success: boolean; data: SlackIntegrationView }>(`/api/projects/${projectId}/slack`, patch),
    onSuccess: () => {
      setError(null);
      refetch();
    },
    onError: (err: Error) => setError(err.message),
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete<{ success: boolean }>(`/api/projects/${projectId}/slack`),
    onSuccess: () => refetch(),
    onError: (err: Error) => setError(err.message),
  });

  if (isLoading) {
    return (
      <div className="card p-6 flex items-center justify-center h-32">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="card p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Slack Notifications</h2>
        <p className="text-sm text-gray-500 mt-1">Post task activity from this project to a Slack channel.</p>
      </div>

      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!slack?.connected ? (
        slack?.canConnect ? (
          <button onClick={connect} className="btn btn-primary">
            Connect Slack
          </button>
        ) : (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Slack is not configured. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET on the server.
          </p>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            Connected to {slack.teamName ?? 'Slack'}, posting to #{slack.channelName}
          </div>

          <label className="block text-sm">
            <span className="text-gray-700">Channel</span>
            <select
              className="input mt-1"
              value={slack.channelId ?? ''}
              onChange={(e) => update.mutate({ channelId: e.target.value })}
              disabled={update.isPending || !channels}
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
          </label>

          <fieldset className="space-y-2">
            <legend className="text-sm text-gray-700 mb-1">Notify on</legend>
            {NOTIFICATION_LABELS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={slack.notifications?.[key] ?? true}
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
                onChange={(e) => update.mutate({ isEnabled: e.target.checked })}
                disabled={update.isPending}
              />
              Enabled
            </label>
            <button onClick={() => disconnect.mutate()} className="btn btn-secondary ml-auto" disabled={disconnect.isPending}>
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
