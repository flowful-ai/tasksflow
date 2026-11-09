/**
 * Recently opened tasks and projects for the ⌘K palette, per workspace, in
 * localStorage. Storage can be missing or throw (private mode, blocked site
 * data), so every access is wrapped and failures mean "no recents".
 */

export interface RecentItem {
  kind: 'task' | 'project';
  id: string;
  /** Task key ("TF-12") or project identifier. */
  key: string;
  title: string;
}

const MAX_RECENTS = 8;
const storageKey = (workspaceId: string) => `flowtask-recent:${workspaceId}`;

function isRecentItem(value: object | null): value is RecentItem {
  if (value === null || !('kind' in value) || !('id' in value) || !('key' in value) || !('title' in value)) return false;
  return (
    (value.kind === 'task' || value.kind === 'project') &&
    typeof value.id === 'string' &&
    typeof value.key === 'string' &&
    typeof value.title === 'string'
  );
}

/** Parse stored JSON, dropping anything malformed. */
export function parseRecents(raw: string | null): RecentItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items: unknown[] = parsed;
    return items.filter((item): item is RecentItem => typeof item === 'object' && isRecentItem(item)).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/** Put `item` first, de-duplicated, capped. */
export function pushRecent(list: RecentItem[], item: RecentItem): RecentItem[] {
  return [item, ...list.filter((r) => !(r.kind === item.kind && r.id === item.id))].slice(0, MAX_RECENTS);
}

export function readRecents(workspaceId: string | null | undefined): RecentItem[] {
  if (!workspaceId) return [];
  try {
    return parseRecents(window.localStorage.getItem(storageKey(workspaceId)));
  } catch {
    return [];
  }
}

export function recordRecent(workspaceId: string | null | undefined, item: RecentItem): void {
  if (!workspaceId) return;
  try {
    const next = pushRecent(readRecents(workspaceId), item);
    window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(next));
  } catch {
    // Storage unavailable: recents are a convenience only.
  }
}
