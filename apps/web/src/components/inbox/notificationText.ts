import type { NotificationDto } from '../../api/types';

/** "Jo Doe" → "Jo D."; one word stays as is. */
export function shortName(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Someone';
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]![0]?.toUpperCase()}.`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : '')).toUpperCase();
}

function dataString(n: NotificationDto, key: string): string | null {
  const value = n.data[key];
  return typeof value === 'string' ? value : null;
}

function dataStateName(n: NotificationDto, key: string): string | null {
  const value = n.data[key];
  return value && typeof value === 'object' && 'name' in value && typeof value.name === 'string' ? value.name : null;
}

const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

export interface NotificationText {
  /** Who did it ("Jo D."), or null for system notifications. */
  actor: string | null;
  /** The rest of the sentence, before the task key. */
  verb: string;
  /** After the key ("to Done"). */
  suffix: string;
  snippet: string;
}

/** "Jo D. mentioned you on TF-104" + snippet. */
export function describeNotification(n: NotificationDto): NotificationText {
  const actor = n.actor ? shortName(n.actor.name) : null;
  const title = n.task?.title ?? '';
  const excerpt = dataString(n, 'excerpt');
  const due = dataString(n, 'dueDate');
  switch (n.type) {
    case 'mentioned':
      return { actor, verb: 'mentioned you on', suffix: '', snippet: excerpt ?? title };
    case 'commented':
      return { actor, verb: 'commented on', suffix: '', snippet: excerpt ?? title };
    case 'assigned':
      return { actor, verb: 'assigned you', suffix: '', snippet: title };
    case 'status_changed': {
      const to = dataStateName(n, 'toState');
      return { actor, verb: 'moved', suffix: to ? `to ${to}` : '', snippet: title };
    }
    case 'due_soon':
      return { actor: null, verb: '', suffix: 'is due soon', snippet: due ? `Due ${formatDay(due)}` : title };
    case 'overdue':
      return { actor: null, verb: '', suffix: 'is overdue', snippet: due ? `Was due ${formatDay(due)}` : title };
    case 'github':
      return { actor: actor ?? 'GitHub', verb: 'updated', suffix: '', snippet: dataString(n, 'message') ?? title };
    default:
      return { actor, verb: 'updated', suffix: '', snippet: title };
  }
}

/** Plain-text sentence for accessible names. */
export function notificationSentence(n: NotificationDto): string {
  const t = describeNotification(n);
  return [t.actor, t.verb, n.task?.key ?? 'a task', t.suffix].filter(Boolean).join(' ');
}
