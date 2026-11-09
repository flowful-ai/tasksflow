import { isUuid } from '../workspace/authorization.js';
import { escapeLike } from '@flowtask/shared';
import {
  eq,
  and,
  or,
  gt,
  gte,
  lt,
  lte,
  inArray,
  notInArray,
  like,
  isNull,
  isNotNull,
  bindIfParam,
  SQL,
  sql,
} from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { tasks, taskStates, taskAssignees, taskLabels } from '../../db/index.js';
import { FilterOperatorSchema } from '@flowtask/shared';
import type { FilterGroup, FilterCondition } from '@flowtask/shared';
import type { FilterContext } from './types.js';

/**
 * Smart View filter engine: converts a JSON filter group into a parameterised
 * SQL WHERE clause over `tasks` (left-joined with `task_states`).
 *
 * ## Template values
 * A condition value may be a template, resolved against the filter context:
 *
 * | Template              | Meaning (in the context timezone, default UTC)            |
 * |-----------------------|-----------------------------------------------------------|
 * | `{{current_user}}`    | the viewing user's id                                     |
 * | `{{now}}`             | the current instant                                       |
 * | `{{today}}`           | alias of `{{start_of_day}}`                               |
 * | `{{start_of_day}}`    | today 00:00:00.000                                        |
 * | `{{end_of_day}}`      | today 23:59:59.999                                        |
 * | `{{start_of_week}}`   | Sunday 00:00:00.000 of the current week                   |
 * | `{{end_of_week}}`     | Saturday 23:59:59.999 of the current week                 |
 * | `{{start_of_month}}`  | the 1st of the month, 00:00:00.000                        |
 * | `{{end_of_month}}`    | the last day of the month, 23:59:59.999                   |
 *
 * Every date template accepts an offset: `{{now + 7d}}`, `{{start_of_day - 1d}}`,
 * `{{end_of_week + 1w}}`. Units:
 * - `h` hours: an absolute duration (N × 3600 s).
 * - `d` days and `w` weeks (7 days): calendar days, keeping the wall-clock time
 *   in the context timezone across DST changes.
 * - `m` MONTHS (not minutes; kept for compatibility): calendar months, keeping
 *   the wall-clock time; the day is clamped to the target month's length
 *   (Jan 31 + 1m = Feb 28/29).
 *
 * ## NULL semantics
 * `neq`, `nin` and `not_contains` keep rows whose value is NULL ("assignee is
 * not me" includes unassigned tasks). Assignee and label fields are
 * many-to-many and compile to EXISTS / NOT EXISTS subqueries, so they never
 * need a join and never duplicate rows.
 */

/** Filter context plus the IANA timezone used for calendar templates. */
export type FilterEngineContext = FilterContext & { timezone: string };

export interface CreateFilterContextOptions {
  /** IANA timezone, e.g. "Europe/Paris". Invalid or missing → "UTC". */
  timezone?: string;
  /** Override the current instant (tests). */
  now?: Date;
}

// ============ Timezone helpers (Intl only) ============

interface CivilDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function getFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

/** Wall-clock date/time of an instant in a timezone. */
function toZoned(instant: number, timezone: string): CivilDateTime {
  const parts = getFormatter(timezone).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? parseInt(part.value, 10) : 0;
  };
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
    millisecond: new Date(instant).getUTCMilliseconds(),
  };
}

function civilToUtcMs(c: CivilDateTime): number {
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second, c.millisecond);
}

/** Normalise overflowing fields (day 32, month 13, …) via Date.UTC. */
function normalizeCivil(c: CivilDateTime): CivilDateTime {
  const d = new Date(civilToUtcMs(c));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millisecond: d.getUTCMilliseconds(),
  };
}

function offsetAt(instant: number, timezone: string): number {
  return civilToUtcMs(toZoned(instant, timezone)) - instant;
}

/**
 * Instant of a wall-clock time in a timezone. Ambiguous times (DST fall-back)
 * resolve to the earlier instant; non-existent times (spring-forward gap)
 * shift forward, like Temporal's "compatible" disambiguation.
 */
function fromZoned(civil: CivilDateTime, timezone: string): Date {
  const target = normalizeCivil(civil);
  const asUtc = civilToUtcMs(target);
  const first = asUtc - offsetAt(asUtc, timezone);
  const second = asUtc - offsetAt(first, timezone);
  const candidates = [first, second].sort((a, b) => a - b);
  for (const candidate of candidates) {
    if (civilToUtcMs(toZoned(candidate, timezone)) === asUtc) {
      return new Date(candidate);
    }
  }
  // In a gap: neither candidate exists on the wall clock; take the later one.
  return new Date(candidates[1]!);
}

function startOfDayCivil(c: CivilDateTime): CivilDateTime {
  return { ...c, hour: 0, minute: 0, second: 0, millisecond: 0 };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addCalendarDays(instant: Date, days: number, timezone: string): Date {
  const civil = toZoned(instant.getTime(), timezone);
  return fromZoned({ ...civil, day: civil.day + days }, timezone);
}

function addCalendarMonths(instant: Date, months: number, timezone: string): Date {
  const civil = toZoned(instant.getTime(), timezone);
  const monthIndex = civil.year * 12 + (civil.month - 1) + months;
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  const day = Math.min(civil.day, daysInMonth(year, month));
  return fromZoned({ ...civil, year, month, day }, timezone);
}

function startOfDay(now: Date, timezone: string): Date {
  return fromZoned(startOfDayCivil(toZoned(now.getTime(), timezone)), timezone);
}

function endOfDay(now: Date, timezone: string): Date {
  const today = startOfDayCivil(toZoned(now.getTime(), timezone));
  return new Date(fromZoned({ ...today, day: today.day + 1 }, timezone).getTime() - 1);
}

function resolveTimezone(timezone: string | undefined): string {
  return timezone && isValidTimeZone(timezone) ? timezone : 'UTC';
}

// ============ Template resolution ============

type FilterScalar = string | number | boolean | Date | null;
type ResolvedValue = FilterScalar | FilterScalar[];

const DATE_ANCHORS = [
  'now',
  'today',
  'start_of_day',
  'end_of_day',
  'start_of_week',
  'end_of_week',
  'start_of_month',
  'end_of_month',
] as const;
type DateAnchor = (typeof DATE_ANCHORS)[number];

function isDateAnchor(name: string): name is DateAnchor {
  return (DATE_ANCHORS as readonly string[]).includes(name);
}

const TEMPLATE_RE = /^\{\{\s*([a-z_]+)\s*(?:([+-])\s*(\d{1,6})\s*([hdwm]))?\s*\}\}$/;

function anchorInstant(anchor: DateAnchor, ctx: FilterContext, timezone: string): Date {
  switch (anchor) {
    case 'now':
      return ctx.now;
    case 'today':
    case 'start_of_day':
      return startOfDay(ctx.now, timezone);
    case 'end_of_day':
      return endOfDay(ctx.now, timezone);
    case 'start_of_week':
      return ctx.startOfWeek;
    case 'end_of_week':
      return ctx.endOfWeek;
    case 'start_of_month':
      return ctx.startOfMonth;
    case 'end_of_month':
      return ctx.endOfMonth;
  }
}

/**
 * Resolve a date template (`{{now}}`, `{{start_of_week - 1w}}`, …) to an
 * instant. Returns null when the string is not a date template.
 */
function resolveDateTemplate(
  template: string,
  ctx: FilterContext & { timezone?: string }
): Date | null {
  const match = TEMPLATE_RE.exec(template.trim());
  if (!match) return null;
  const [, name, sign, amountText, unit] = match;
  if (!name || !isDateAnchor(name)) return null;

  const timezone = resolveTimezone(ctx.timezone);
  const base = anchorInstant(name, ctx, timezone);
  if (!sign || !amountText || !unit) return new Date(base.getTime());

  const amount = parseInt(amountText, 10) * (sign === '+' ? 1 : -1);
  switch (unit) {
    case 'h':
      return new Date(base.getTime() + amount * 3_600_000);
    case 'd':
      return addCalendarDays(base, amount, timezone);
    case 'w':
      return addCalendarDays(base, amount * 7, timezone);
    case 'm':
      return addCalendarMonths(base, amount, timezone);
    default:
      return null;
  }
}

function isScalar(value: unknown): value is FilterScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  );
}

function resolveScalar(
  value: FilterScalar,
  ctx: FilterContext & { timezone?: string }
): FilterScalar {
  if (typeof value !== 'string' || !value.startsWith('{{')) return value;
  if (value.trim() === '{{current_user}}') return ctx.currentUserId;
  return resolveDateTemplate(value, ctx) ?? value;
}

/**
 * Resolve template variables in a condition value. `value` comes straight from
 * the stored JSON. Returns undefined for shapes the engine cannot use (objects,
 * nested arrays), which makes the condition a no-op.
 */
function resolveValue(
  value: unknown,
  ctx: FilterContext & { timezone?: string }
): ResolvedValue | undefined {
  if (Array.isArray(value)) {
    const items: FilterScalar[] = [];
    for (const item of value) {
      if (!isScalar(item)) return undefined;
      items.push(resolveScalar(item, ctx));
    }
    return items;
  }
  if (value === undefined) return null;
  if (!isScalar(value)) return undefined;
  return resolveScalar(value, ctx);
}

// ============ Field mapping ============

type FieldKind = 'uuid' | 'text' | 'timestamp' | 'number';

interface ColumnField {
  source: 'column';
  kind: FieldKind;
  column: PgColumn;
  join?: 'task_states';
}

interface RelationField {
  source: 'relation';
  relation: 'assignee' | 'label';
}

type FieldMapping = ColumnField | RelationField;

const col = (column: PgColumn, kind: FieldKind, join?: 'task_states'): ColumnField => ({
  source: 'column',
  kind,
  column,
  join,
});

// Field mapping from filter field names to database columns (allowlist).
const FIELD_MAP: Record<string, FieldMapping> = {
  id: col(tasks.id, 'uuid'),
  project_id: col(tasks.projectId, 'uuid'),
  state_id: col(tasks.stateId, 'uuid'),
  title: col(tasks.title, 'text'),
  description: col(tasks.description, 'text'),
  priority: col(tasks.priority, 'text'),
  due_date: col(tasks.dueDate, 'timestamp'),
  start_date: col(tasks.startDate, 'timestamp'),
  created_at: col(tasks.createdAt, 'timestamp'),
  updated_at: col(tasks.updatedAt, 'timestamp'),
  created_by: col(tasks.createdBy, 'uuid'),
  sequence_number: col(tasks.sequenceNumber, 'number'),
  // Fields on the left-joined task_states table
  'state.category': col(taskStates.category, 'text', 'task_states'),
  'state.name': col(taskStates.name, 'text', 'task_states'),
  // Many-to-many fields (EXISTS subqueries)
  assignee_id: { source: 'relation', relation: 'assignee' },
  label_id: { source: 'relation', relation: 'label' },
};

/**
 * Coerce a resolved scalar to the column's kind. Returns undefined when the
 * value can't be compared with the column (e.g. "abc" against a uuid), so a
 * bad saved filter can't turn into a SQL error.
 */
function coerce(value: FilterScalar, kind: FieldKind): string | number | Date | undefined {
  if (value === null || typeof value === 'boolean') return undefined;
  switch (kind) {
    case 'uuid':
      return typeof value === 'string' && isUuid(value) ? value : undefined;
    case 'text':
      return value instanceof Date ? value.toISOString() : String(value);
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
      return Number.isFinite(n) ? n : undefined;
    }
    case 'timestamp': {
      const d = value instanceof Date ? value : new Date(value);
      return Number.isNaN(d.getTime()) ? undefined : d;
    }
  }
}

interface CoercedList {
  values: (string | number | Date)[];
  hasNull: boolean;
}

function coerceList(values: FilterScalar[], kind: FieldKind): CoercedList {
  const result: CoercedList = { values: [], hasNull: false };
  for (const value of values) {
    if (value === null) {
      result.hasNull = true;
      continue;
    }
    const coerced = coerce(value, kind);
    if (coerced !== undefined) result.values.push(coerced);
  }
  return result;
}

// ============ Condition builders ============

function buildColumnCondition(field: ColumnField, op: string, value: ResolvedValue): SQL | null {
  const { column, kind } = field;

  if (op === 'is_null') return isNull(column);
  if (op === 'is_not_null') return isNotNull(column);

  if (op === 'in' || op === 'nin') {
    if (!Array.isArray(value) || value.length === 0) return null;
    const list = coerceList(value, kind);
    if (op === 'in') {
      const parts: SQL[] = [];
      if (list.values.length) parts.push(inArray(column, list.values));
      if (list.hasNull) parts.push(isNull(column));
      if (parts.length === 0) return sql`false`;
      return parts.length === 1 ? parts[0]! : or(...parts)!;
    }
    // nin keeps NULLs unless null itself is listed.
    if (list.values.length === 0) return list.hasNull ? isNotNull(column) : null;
    const notIn = notInArray(column, list.values);
    return list.hasNull ? and(isNotNull(column), notIn)! : or(isNull(column), notIn)!;
  }

  if (Array.isArray(value)) return null;

  if (op === 'eq' || op === 'neq') {
    if (value === null) return op === 'eq' ? isNull(column) : isNotNull(column);
    const coerced = coerce(value, kind);
    if (coerced === undefined) return op === 'eq' ? sql`false` : null;
    return op === 'eq'
      ? eq(column, coerced)
      : sql`${column} IS DISTINCT FROM ${bindIfParam(coerced, column)}`;
  }

  if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
    if (value === null || kind === 'uuid') return null;
    const coerced = coerce(value, kind);
    if (coerced === undefined) return null;
    switch (op) {
      case 'gt':
        return gt(column, coerced);
      case 'gte':
        return gte(column, coerced);
      case 'lt':
        return lt(column, coerced);
      case 'lte':
        return lte(column, coerced);
    }
  }

  if (op === 'contains' || op === 'not_contains' || op === 'starts_with' || op === 'ends_with') {
    // String matching only makes sense (and only type-checks in SQL) on text.
    if (kind !== 'text' || value === null) return null;
    const text = escapeLike(String(value instanceof Date ? value.toISOString() : value));
    switch (op) {
      case 'contains':
        return like(column, `%${text}%`);
      case 'not_contains':
        return or(isNull(column), sql`${column} NOT LIKE ${`%${text}%`}`)!;
      case 'starts_with':
        return like(column, `${text}%`);
      case 'ends_with':
        return like(column, `%${text}`);
    }
  }

  return null;
}

function relationExists(relation: RelationField['relation'], values: string[] | null): SQL {
  if (relation === 'assignee') {
    const match = values ? sql` AND ${inArray(taskAssignees.userId, values)}` : sql``;
    return sql`EXISTS (SELECT 1 FROM ${taskAssignees} WHERE ${taskAssignees.taskId} = ${tasks.id}${match})`;
  }
  const match = values ? sql` AND ${inArray(taskLabels.labelId, values)}` : sql``;
  return sql`EXISTS (SELECT 1 FROM ${taskLabels} WHERE ${taskLabels.taskId} = ${tasks.id}${match})`;
}

function relationNotExists(relation: RelationField['relation'], values: string[] | null): SQL {
  return sql`NOT ${relationExists(relation, values)}`;
}

function buildRelationCondition(
  field: RelationField,
  op: string,
  value: ResolvedValue
): SQL | null {
  const { relation } = field;

  if (op === 'is_null') return relationNotExists(relation, null);
  if (op === 'is_not_null') return relationExists(relation, null);

  if (op === 'eq' || op === 'neq') {
    if (Array.isArray(value)) return null;
    if (value === null)
      return op === 'eq' ? relationNotExists(relation, null) : relationExists(relation, null);
    const id = coerce(value, 'uuid');
    if (typeof id !== 'string') return op === 'eq' ? sql`false` : null;
    return op === 'eq' ? relationExists(relation, [id]) : relationNotExists(relation, [id]);
  }

  if (op === 'in' || op === 'nin') {
    if (!Array.isArray(value) || value.length === 0) return null;
    const list = coerceList(value, 'uuid');
    const ids = list.values.filter((v): v is string => typeof v === 'string');
    if (op === 'in') {
      const parts: SQL[] = [];
      if (ids.length) parts.push(relationExists(relation, ids));
      if (list.hasNull) parts.push(relationNotExists(relation, null));
      if (parts.length === 0) return sql`false`;
      return parts.length === 1 ? parts[0]! : or(...parts)!;
    }
    const parts: SQL[] = [];
    if (ids.length) parts.push(relationNotExists(relation, ids));
    if (list.hasNull) parts.push(relationExists(relation, null));
    if (parts.length === 0) return null;
    return parts.length === 1 ? parts[0]! : and(...parts)!;
  }

  // Comparisons and string matching don't apply to id sets.
  return null;
}

// Build SQL condition from a filter condition
function buildCondition(
  condition: FilterCondition,
  ctx: FilterContext & { timezone?: string }
): SQL | null {
  const mapping = FIELD_MAP[condition.field];
  if (!mapping) {
    console.warn(`Unknown filter field: ${condition.field}`);
    return null;
  }

  if (!FilterOperatorSchema.safeParse(condition.op).success) {
    console.warn(`Unknown filter operator: ${condition.op}`);
    return null;
  }

  const value = resolveValue(condition.value, ctx);
  if (value === undefined) return null;

  return mapping.source === 'relation'
    ? buildRelationCondition(mapping, condition.op, value)
    : buildColumnCondition(mapping, condition.op, value);
}

// Check if a condition is a filter group
function isFilterGroup(condition: FilterCondition | FilterGroup): condition is FilterGroup {
  return 'operator' in condition && 'conditions' in condition;
}

// Build SQL conditions from a filter group
function buildGroupConditions(
  group: FilterGroup,
  ctx: FilterContext & { timezone?: string }
): SQL | null {
  const conditions: SQL[] = [];

  for (const item of group.conditions) {
    const condition = isFilterGroup(item)
      ? buildGroupConditions(item, ctx)
      : buildCondition(item, ctx);
    if (condition) {
      conditions.push(condition);
    }
  }

  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0]!;

  return group.operator === 'AND' ? and(...conditions)! : or(...conditions)!;
}

/**
 * FilterEngine converts Smart View filter configurations into SQL WHERE clauses.
 */
export class FilterEngine {
  /**
   * Create a filter context with the current user and calendar anchors computed
   * in `options.timezone` (IANA, default/invalid → UTC).
   */
  static createContext(
    userId: string,
    options: CreateFilterContextOptions = {}
  ): FilterEngineContext {
    const timezone = resolveTimezone(options.timezone);
    const now = options.now ? new Date(options.now.getTime()) : new Date();

    const today = startOfDayCivil(toZoned(now.getTime(), timezone));
    const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay(); // 0 = Sunday

    const startOfWeek = fromZoned({ ...today, day: today.day - weekday }, timezone);
    const endOfWeek = new Date(
      fromZoned({ ...today, day: today.day - weekday + 7 }, timezone).getTime() - 1
    );
    const startOfMonth = fromZoned({ ...today, day: 1 }, timezone);
    const endOfMonth = new Date(
      fromZoned({ ...today, month: today.month + 1, day: 1 }, timezone).getTime() - 1
    );

    return {
      currentUserId: userId,
      now,
      startOfWeek,
      endOfWeek,
      startOfMonth,
      endOfMonth,
      timezone,
    };
  }

  /**
   * Resolve a date template such as `{{now + 7d}}` against a context.
   * Returns null when the string is not a date template.
   */
  static resolveDateTemplate(
    template: string,
    ctx: FilterContext & { timezone?: string }
  ): Date | null {
    return resolveDateTemplate(template, ctx);
  }

  /**
   * Build SQL WHERE clause from a filter configuration. A context without a
   * timezone is treated as UTC.
   */
  static buildWhereClause(
    filters: FilterGroup,
    ctx: FilterContext & { timezone?: string }
  ): SQL | null {
    return buildGroupConditions(filters, ctx);
  }

  /**
   * Check which tables need to be joined based on filter fields. Assignee and
   * label fields compile to EXISTS subqueries, so only state fields need a join
   * (TaskService always left-joins task_states).
   */
  static getRequiredJoins(
    filters: FilterGroup
  ): Set<'task_states' | 'task_assignees' | 'task_labels'> {
    const joins = new Set<'task_states' | 'task_assignees' | 'task_labels'>();

    function checkConditions(group: FilterGroup) {
      for (const item of group.conditions) {
        if (isFilterGroup(item)) {
          checkConditions(item);
        } else {
          const mapping = FIELD_MAP[item.field];
          if (mapping?.source === 'column' && mapping.join) {
            joins.add(mapping.join);
          }
        }
      }
    }

    checkConditions(filters);
    return joins;
  }

  /**
   * Validate a filter configuration.
   */
  static validate(filters: FilterGroup): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    function checkConditions(group: FilterGroup, path: string = '') {
      if (group.operator !== 'AND' && group.operator !== 'OR') {
        errors.push(`${path}: Invalid operator ${JSON.stringify(group.operator)}`);
      }

      if (!Array.isArray(group.conditions)) {
        errors.push(`${path}: conditions must be an array`);
        return;
      }

      group.conditions.forEach((item, index) => {
        const itemPath = `${path}[${index}]`;

        if (isFilterGroup(item)) {
          checkConditions(item, itemPath);
        } else {
          if (!item.field) {
            errors.push(`${itemPath}: missing field`);
          } else if (!FIELD_MAP[item.field]) {
            errors.push(`${itemPath}: unknown field "${item.field}"`);
          }

          if (!item.op) {
            errors.push(`${itemPath}: missing operator`);
          } else if (!FilterOperatorSchema.safeParse(item.op).success) {
            errors.push(`${itemPath}: unknown operator "${item.op}"`);
          }
        }
      });
    }

    checkConditions(filters);

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
