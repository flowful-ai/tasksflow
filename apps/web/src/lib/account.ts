/** Pure helpers for the Profile and Workspace settings tabs. */
import type { WorkspaceRole } from '@flowtask/shared';

/** Same limit as the API (UpdateWorkspaceSchema / Better Auth user name column). */
export const MAX_NAME_LENGTH = 100;

/** Up to two initials from a display name, else the first letter of the email. */
export function initials(name: string | null | undefined, email?: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = words.at(0)?.charAt(0) ?? '';
  const last = words.length > 1 ? (words.at(-1)?.charAt(0) ?? '') : '';
  if (first) return `${first}${last}`.toUpperCase();
  // No name: two letters from the mailbox, so john.doe@… shows "JD".
  const parts = (email ?? '')
    .trim()
    .split('@')[0]
    .split(/[._+-]+/)
    .filter(Boolean);
  const fromEmail = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : (parts[0]?.charAt(0) ?? '');
  return fromEmail.toUpperCase() || '?';
}

/**
 * The provider avatar of a session user. Better Auth serialises it as `image`
 * (stored in users.avatar_url); older persisted state may carry `avatarUrl`.
 */
export function avatarUrlOf(
  user: { image?: string | null; avatarUrl?: string | null } | null | undefined
): string | null {
  return user?.image || user?.avatarUrl || null;
}

/** Trimmed name, or an error message for the form. */
export function validateName(
  value: string,
  what = 'Name'
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: `${what} is required` };
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `${what} must be at most ${MAX_NAME_LENGTH} characters` };
  }
  return { ok: true, value: trimmed };
}

const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
];

/** "Chrome on macOS" from a user agent; "Unknown device" when there is none. */
export function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent?.trim()) return 'Unknown device';
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  const either = browser ?? system;
  if (either) return either;
  // Non-browser clients (curl, scripts): show the product token.
  return userAgent.split(/[\s/]/)[0] || 'Unknown device';
}

/** Owners and admins may edit the workspace settings. */
export function canEditWorkspace(role: WorkspaceRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * Whether the caller may leave: anyone but the last owner (the API answers
 * 409 "Cannot remove the last owner").
 */
export function canLeaveWorkspace(
  role: WorkspaceRole | null | undefined,
  members: ReadonlyArray<{ role: WorkspaceRole }>
): boolean {
  if (!role) return false;
  if (role !== 'owner') return true;
  return members.filter((m) => m.role === 'owner').length > 1;
}

/** Where to go after leaving or deleting `goneId`: another workspace, or none. */
export function nextWorkspaceId(
  workspaces: ReadonlyArray<{ id: string }>,
  goneId: string
): string | null {
  return workspaces.find((w) => w.id !== goneId)?.id ?? null;
}
