import { z } from 'zod';
import { isJsonObject, JsonObjectSchema, toJsonObject, type JsonObject } from '@flowtask/shared';

/**
 * Cross-instance realtime messages, carried over Postgres NOTIFY.
 *
 * NOTIFY payloads are limited to 8000 bytes. Event data is sent in full when
 * the whole message stays under SAFE_PAYLOAD_BYTES; otherwise only the ids a
 * client needs to refetch are kept and `truncated: true` is set.
 */

export const NOTIFY_CHANNEL = 'flowtask_realtime';
export const SAFE_PAYLOAD_BYTES = 7000;

/** JSON-serialisable event payload (an object, never a primitive). */
export type EventPayload = object;
/** Event data as it travels on the wire: a JSON object. */
export type EventData = JsonObject;

const EventDataSchema = JsonObjectSchema;

const WorkspaceEventSchema = z.object({
  k: z.literal('ws'),
  o: z.string(),
  id: z.string(),
  w: z.string(),
  p: z.string().nullable(),
  e: z.string(),
  d: EventDataSchema,
});

const UserEventSchema = z.object({
  k: z.literal('user'),
  o: z.string(),
  id: z.string(),
  u: z.string(),
  e: z.string(),
  d: EventDataSchema,
});

const MemberRemovedSchema = z.object({
  k: z.literal('member_removed'),
  o: z.string(),
  w: z.string(),
  u: z.string(),
});

const AccessChangedSchema = z.object({
  k: z.literal('access_changed'),
  o: z.string(),
  w: z.string(),
  u: z.string().nullable(),
});

/** Drop `key` (or everything, when null) from the per-process cache named `c`. */
const CacheInvalidatedSchema = z.object({
  k: z.literal('invalidate'),
  o: z.string(),
  c: z.string(),
  key: z.string().nullable(),
});

const PingSchema = z.object({
  k: z.literal('ping'),
  o: z.string(),
});

export const WireMessageSchema = z.discriminatedUnion('k', [
  WorkspaceEventSchema,
  UserEventSchema,
  MemberRemovedSchema,
  AccessChangedSchema,
  CacheInvalidatedSchema,
  PingSchema,
]);

export type WireMessage = z.infer<typeof WireMessageSchema>;
export type WorkspaceEventMessage = z.infer<typeof WorkspaceEventSchema>;
export type UserEventMessage = z.infer<typeof UserEventSchema>;

const ID_KEYS = [
  'id',
  'projectId',
  'taskId',
  'commentId',
  'workspaceId',
  'userId',
  'stateId',
] as const;

/** Copy an event payload into a JSON object (drops prototypes, functions, undefined). */
export function toEventData(data: EventPayload): EventData {
  const parsed: unknown = JSON.parse(JSON.stringify(data));
  return toJsonObject(parsed);
}

/** Keep only the identifiers of an event payload. */
export function reduceToIds(data: EventData): EventData {
  const reduced: EventData = { truncated: true };
  for (const key of ID_KEYS) {
    const value = data[key];
    if (typeof value === 'string' || typeof value === 'number') reduced[key] = value;
  }
  const comment = data.comment;
  if (!('commentId' in reduced) && isJsonObject(comment) && typeof comment.id === 'string') {
    reduced.commentId = comment.id;
  }
  const project = data.project;
  if (!('projectId' in reduced) && isJsonObject(project) && typeof project.id === 'string') {
    reduced.projectId = project.id;
  }
  return reduced;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Serialise a message carrying event data, falling back to ids only when the
 * full payload would not fit. Returns the message actually sent (so local
 * delivery matches remote delivery) or null when even the reduced form is
 * too large.
 */
export function encodeWithinLimit<M extends WorkspaceEventMessage | UserEventMessage>(
  message: M
): { message: M; payload: string } | null {
  const full = JSON.stringify(message);
  if (byteLength(full) <= SAFE_PAYLOAD_BYTES) return { message, payload: full };

  const reduced: M = { ...message, d: reduceToIds(message.d) };
  const payload = JSON.stringify(reduced);
  if (byteLength(payload) <= SAFE_PAYLOAD_BYTES) return { message: reduced, payload };
  return null;
}

export function decodeWireMessage(payload: string): WireMessage | null {
  try {
    const parsed = WireMessageSchema.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function sanitizeEventName(event: string): string {
  return event.replace(/[\r\n]/g, '').slice(0, 100) || 'message';
}

/** Format one Server-Sent Events frame. */
export function formatSseFrame(id: string, event: string, data: EventData): string {
  const body = JSON.stringify({ ...data, timestamp: new Date().toISOString() });
  return `id: ${id}\nevent: ${sanitizeEventName(event)}\ndata: ${body}\n\n`;
}
