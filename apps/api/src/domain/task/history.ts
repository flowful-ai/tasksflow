/**
 * Per-task activity timeline built from task_events, with display values
 * resolved for ids (states, users, labels, tasks, comments) so the client can
 * render "Jo moved Todo → In progress" without extra lookups.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { comments, labels, mcpOAuthClients, taskEvents, taskStates, tasks, users } from '../../db/index.js';
import { isJsonObject, toJsonValue, ok, err, type JsonValue, type Result } from '@flowtask/shared';
import { toError } from './errors.js';
import { selectTaskRefs, toTaskRef } from './queries.js';
import type { TaskEventType, TaskRef } from './types.js';

export type HistoryDisplayValue =
  | { kind: 'state'; id: string; name: string; category: string; color: string | null }
  | { kind: 'user'; id: string; name: string | null; avatarUrl: string | null }
  | { kind: 'label'; id: string; name: string; color: string | null }
  | { kind: 'task'; task: TaskRef }
  | { kind: 'comment'; id: string; excerpt: string | null; deleted: boolean }
  | { kind: 'relation'; type: string; direction: 'outgoing' | 'incoming'; task: TaskRef | null }
  | { kind: 'value'; value: JsonValue };

export interface TaskHistoryItem {
  id: string;
  type: TaskEventType | string;
  /** Changed field for 'updated'/'moved' (title, description, stateId, priority, dueDate, startDate, parentId). */
  field: string | null;
  createdAt: Date;
  actor: { id: string; name: string | null; avatarUrl: string | null } | null;
  /** MCP client (AI agent) that performed the change on behalf of the actor. */
  agent: { id: string; name: string } | null;
  /** Raw stored values (ids, ISO dates, strings). */
  oldValue: JsonValue;
  newValue: JsonValue;
  /** Resolved display values (null when there is nothing to show). */
  from: HistoryDisplayValue | null;
  to: HistoryDisplayValue | null;
}

export interface TaskHistoryPage {
  items: TaskHistoryItem[];
  nextCursor: string | null;
}

interface Cursor {
  ts: string;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Postgres timestamp[tz]::text, e.g. "2026-11-09 10:00:00.123456+00". */
const PG_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?)?$/;

export function encodeHistoryCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.ts}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeHistoryCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  if (sep <= 0) return null;
  const ts = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!UUID_RE.test(id) || !PG_TIMESTAMP_RE.test(ts)) return null;
  return { ts, id };
}

function asString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function asUuid(value: JsonValue | undefined): string | null {
  const s = asString(value);
  return s && UUID_RE.test(s) ? s : null;
}

function snapshotState(meta: JsonValue, side: 'from' | 'to'): HistoryDisplayValue | null {
  if (!isJsonObject(meta)) return null;
  const value = meta[side];
  if (!isJsonObject(value)) return null;
  const id = asString(value.id);
  const name = asString(value.name);
  const category = asString(value.category);
  return id && name && category ? { kind: 'state', id, name, category, color: null } : null;
}

export class TaskHistoryService {
  constructor(private db: Database) {}

  async list(taskId: string, options: { cursor?: string; limit?: number } = {}): Promise<Result<TaskHistoryPage, Error>> {
    try {
      const limit = Math.max(1, Math.min(100, options.limit ?? 50));
      const cursor = decodeHistoryCursor(options.cursor);
      const conditions = [eq(taskEvents.taskId, taskId)];
      if (cursor) {
        conditions.push(sql`(${taskEvents.createdAt}, ${taskEvents.id}) < (${cursor.ts}::timestamp, ${cursor.id}::uuid)`);
      }

      const rows = await this.db
        .select({
          id: taskEvents.id,
          type: taskEvents.eventType,
          field: taskEvents.fieldName,
          oldValue: taskEvents.oldValue,
          newValue: taskEvents.newValue,
          metadata: taskEvents.metadata,
          createdAt: taskEvents.createdAt,
          cursorTs: sql<string>`${taskEvents.createdAt}::text`,
          actorId: users.id,
          actorName: users.name,
          actorAvatar: users.avatarUrl,
          agentId: mcpOAuthClients.clientId,
          agentName: mcpOAuthClients.clientName,
        })
        .from(taskEvents)
        .leftJoin(users, eq(taskEvents.actorId, users.id))
        .leftJoin(mcpOAuthClients, eq(taskEvents.mcpClientId, mcpOAuthClients.clientId))
        .where(and(...conditions))
        .orderBy(desc(taskEvents.createdAt), desc(taskEvents.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const events = page.map((r) => ({
        ...r,
        oldValue: toJsonValue(r.oldValue),
        newValue: toJsonValue(r.newValue),
        metadata: toJsonValue(r.metadata),
      }));

      // Collect ids to resolve.
      const stateIds = new Set<string>();
      const userIds = new Set<string>();
      const labelIds = new Set<string>();
      const taskIds = new Set<string>();
      const commentIds = new Set<string>();
      for (const e of events) {
        const values = [e.oldValue, e.newValue];
        if (e.field === 'stateId') values.forEach((v) => asUuid(v) && stateIds.add(asUuid(v)!));
        if (e.field === 'parentId') values.forEach((v) => asUuid(v) && taskIds.add(asUuid(v)!));
        if (e.type === 'assigned' || e.type === 'unassigned') values.forEach((v) => asUuid(v) && userIds.add(asUuid(v)!));
        if (e.type === 'labeled' || e.type === 'unlabeled') values.forEach((v) => asUuid(v) && labelIds.add(asUuid(v)!));
        if (e.type === 'commented' && isJsonObject(e.newValue)) {
          const id = asUuid(e.newValue.commentId);
          if (id) commentIds.add(id);
        }
        if (e.type === 'relation_added' || e.type === 'relation_removed') {
          for (const v of values) {
            if (isJsonObject(v)) {
              const a = asUuid(v.taskId);
              const b = asUuid(v.relatedTaskId);
              if (a) taskIds.add(a);
              if (b) taskIds.add(b);
            }
          }
        }
      }

      const [stateRows, userRows, labelRows, taskRows, commentRows] = await Promise.all([
        stateIds.size
          ? this.db
              .select({ id: taskStates.id, name: taskStates.name, category: taskStates.category, color: taskStates.color })
              .from(taskStates)
              .where(inArray(taskStates.id, [...stateIds]))
          : Promise.resolve([]),
        userIds.size
          ? this.db
              .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
              .from(users)
              .where(inArray(users.id, [...userIds]))
          : Promise.resolve([]),
        labelIds.size
          ? this.db
              .select({ id: labels.id, name: labels.name, color: labels.color })
              .from(labels)
              .where(inArray(labels.id, [...labelIds]))
          : Promise.resolve([]),
        taskIds.size ? selectTaskRefs(this.db).where(inArray(tasks.id, [...taskIds])) : Promise.resolve([]),
        commentIds.size
          ? this.db
              .select({ id: comments.id, content: comments.content, deletedAt: comments.deletedAt })
              .from(comments)
              .where(and(inArray(comments.id, [...commentIds]), isNull(comments.deletedAt)))
          : Promise.resolve([]),
      ]);
      const stateMap = new Map(stateRows.map((s) => [s.id, s]));
      const userMap = new Map(userRows.map((u) => [u.id, u]));
      const labelMap = new Map(labelRows.map((l) => [l.id, l]));
      const taskMap = new Map(taskRows.map((t) => [t.id, toTaskRef(t)]));
      const commentMap = new Map(commentRows.map((c) => [c.id, c]));

      const display = (e: (typeof events)[number], side: 'from' | 'to'): HistoryDisplayValue | null => {
        const raw = side === 'from' ? e.oldValue : e.newValue;
        if (e.field === 'stateId') {
          const id = asUuid(raw);
          const state = id ? stateMap.get(id) : undefined;
          if (state) return { kind: 'state', ...state };
          return snapshotState(e.metadata, side);
        }
        if (e.field === 'parentId') {
          const id = asUuid(raw);
          const ref = id ? taskMap.get(id) : undefined;
          return ref ? { kind: 'task', task: ref } : null;
        }
        if (e.type === 'assigned' || e.type === 'unassigned') {
          const id = asUuid(raw);
          if (!id) return null;
          const user = userMap.get(id);
          return { kind: 'user', id, name: user?.name ?? null, avatarUrl: user?.avatarUrl ?? null };
        }
        if (e.type === 'labeled' || e.type === 'unlabeled') {
          const id = asUuid(raw);
          const label = id ? labelMap.get(id) : undefined;
          return label ? { kind: 'label', ...label } : null;
        }
        if (e.type === 'commented') {
          if (side === 'from' || !isJsonObject(raw)) return null;
          const id = asUuid(raw.commentId);
          if (!id) return null;
          const comment = commentMap.get(id);
          return { kind: 'comment', id, excerpt: comment ? comment.content.slice(0, 280) : null, deleted: !comment };
        }
        if (e.type === 'relation_added' || e.type === 'relation_removed') {
          if (!isJsonObject(raw)) return null;
          const from = asUuid(raw.taskId);
          const to = asUuid(raw.relatedTaskId);
          const type = asString(raw.type) ?? 'relates';
          const outgoing = from === taskId;
          const otherId = outgoing ? to : from;
          return {
            kind: 'relation',
            type,
            direction: type === 'relates' || outgoing ? 'outgoing' : 'incoming',
            task: otherId ? (taskMap.get(otherId) ?? null) : null,
          };
        }
        return raw === null ? null : { kind: 'value', value: raw };
      };

      const items: TaskHistoryItem[] = events.map((e) => ({
        id: e.id,
        type: e.type,
        field: e.field,
        createdAt: e.createdAt,
        actor: e.actorId ? { id: e.actorId, name: e.actorName, avatarUrl: e.actorAvatar } : null,
        agent: e.agentId && e.agentName ? { id: e.agentId, name: e.agentName } : null,
        oldValue: e.oldValue,
        newValue: e.newValue,
        from: display(e, 'from'),
        to: display(e, 'to'),
      }));

      const last = events[events.length - 1];
      const nextCursor = rows.length > limit && last ? encodeHistoryCursor({ ts: last.cursorTs, id: last.id }) : null;
      return ok({ items, nextCursor });
    } catch (error) {
      return err(toError(error));
    }
  }
}
