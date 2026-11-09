import { isUuid } from './workspace/authorization.js';

/**
 * Opaque keyset-pagination cursor for "(timestamp, id) < (cursor)" pages:
 * base64url of `<timestamp>|<uuid>`. The timestamp is either Postgres
 * timestamp text (microsecond precision, e.g. "2026-11-09 10:00:00.123456+00")
 * or an ISO string from a JS Date.
 */
export interface KeysetCursor {
  ts: string;
  id: string;
}

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/;

export function encodeKeysetCursor(cursor: KeysetCursor): string {
  return Buffer.from(`${cursor.ts}|${cursor.id}`, 'utf8').toString('base64url');
}

/** The decoded cursor, or null when it is missing or malformed. */
export function decodeKeysetCursor(raw: string | undefined): KeysetCursor | null {
  if (!raw) return null;
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  if (sep <= 0) return null;
  const ts = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!isUuid(id) || !TIMESTAMP_RE.test(ts)) return null;
  return { ts, id };
}

/** Cursor over a JS Date (millisecond precision). */
export function encodeDateCursor(row: { createdAt: Date; id: string }): string {
  return encodeKeysetCursor({ ts: row.createdAt.toISOString(), id: row.id });
}

export function decodeDateCursor(raw: string | undefined): { createdAt: Date; id: string } | null {
  const cursor = decodeKeysetCursor(raw);
  if (!cursor) return null;
  const createdAt = new Date(cursor.ts);
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id: cursor.id };
}
