import { describe, expect, it } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { FilterCondition, FilterGroup, FilterOperator } from '@flowtask/shared';
import { FilterEngine } from './filter-engine.js';

const dialect = new PgDialect();
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-03-08T12:00:00.000Z'); // Sunday; US DST starts this day at 07:00Z

const ctx = FilterEngine.createContext(USER, { now: NOW });

function render(condition: FilterCondition | FilterGroup): { sql: string; params: unknown[] } | null {
  const group: FilterGroup = 'operator' in condition ? condition : { operator: 'AND', conditions: [condition] };
  return toQuery(FilterEngine.buildWhereClause(group, ctx));
}

function toQuery(where: SQL | null): { sql: string; params: unknown[] } | null {
  if (!where) return null;
  const { sql, params } = dialect.sqlToQuery(where);
  return { sql, params };
}

interface OperatorCase {
  op: FilterOperator;
  value: unknown;
  sql: string;
  params: unknown[];
}

describe('FilterEngine operators on a scalar column (tasks.priority)', () => {
  const cases: OperatorCase[] = [
    { op: 'eq', value: 'high', sql: '"tasks"."priority" = $1', params: ['high'] },
    { op: 'neq', value: 'high', sql: '"tasks"."priority" IS DISTINCT FROM $1', params: ['high'] },
    { op: 'gt', value: 'a', sql: '"tasks"."priority" > $1', params: ['a'] },
    { op: 'gte', value: 'a', sql: '"tasks"."priority" >= $1', params: ['a'] },
    { op: 'lt', value: 'z', sql: '"tasks"."priority" < $1', params: ['z'] },
    { op: 'lte', value: 'z', sql: '"tasks"."priority" <= $1', params: ['z'] },
    { op: 'in', value: ['high', 'urgent'], sql: '"tasks"."priority" in ($1, $2)', params: ['high', 'urgent'] },
    {
      op: 'nin',
      value: ['high', 'urgent'],
      sql: '("tasks"."priority" is null or "tasks"."priority" not in ($1, $2))',
      params: ['high', 'urgent'],
    },
    { op: 'contains', value: '50%', sql: '"tasks"."priority" like $1', params: ['%50\\%%'] },
    {
      op: 'not_contains',
      value: 'x_y',
      sql: '("tasks"."priority" is null or "tasks"."priority" NOT LIKE $1)',
      params: ['%x\\_y%'],
    },
    { op: 'starts_with', value: 'hi', sql: '"tasks"."priority" like $1', params: ['hi%'] },
    { op: 'ends_with', value: 'gh', sql: '"tasks"."priority" like $1', params: ['%gh'] },
    { op: 'is_null', value: null, sql: '"tasks"."priority" is null', params: [] },
    { op: 'is_not_null', value: null, sql: '"tasks"."priority" is not null', params: [] },
  ];

  for (const c of cases) {
    it(c.op, () => {
      expect(render({ field: 'priority', op: c.op, value: c.value })).toEqual({ sql: c.sql, params: c.params });
    });
  }

  it('eq/neq null map to IS NULL / IS NOT NULL', () => {
    expect(render({ field: 'priority', op: 'eq', value: null })?.sql).toBe('"tasks"."priority" is null');
    expect(render({ field: 'priority', op: 'neq', value: null })?.sql).toBe('"tasks"."priority" is not null');
  });

  it('in/nin with null entries', () => {
    expect(render({ field: 'priority', op: 'in', value: ['high', null] })?.sql).toBe(
      '("tasks"."priority" in ($1) or "tasks"."priority" is null)'
    );
    expect(render({ field: 'priority', op: 'nin', value: ['high', null] })?.sql).toBe(
      '("tasks"."priority" is not null and "tasks"."priority" not in ($1))'
    );
  });

  it('ignores empty in/nin lists, unknown fields and unknown operators', () => {
    expect(render({ field: 'priority', op: 'in', value: [] })).toBeNull();
    expect(render({ field: 'priority', op: 'nin', value: [] })).toBeNull();
    expect(render({ field: 'nope', op: 'eq', value: 'x' })).toBeNull();
    const badOp = JSON.parse('{"field":"priority","op":"regex","value":"x"}');
    expect(render(badOp)).toBeNull();
  });

  it('does not run string matching on non-text columns', () => {
    expect(render({ field: 'due_date', op: 'contains', value: '2026' })).toBeNull();
    expect(render({ field: 'id', op: 'starts_with', value: 'ab' })).toBeNull();
  });

  it('never sends a non-uuid to a uuid column', () => {
    expect(render({ field: 'created_by', op: 'eq', value: 'not-a-uuid' })?.sql).toBe('false');
    expect(render({ field: 'created_by', op: 'neq', value: 'not-a-uuid' })).toBeNull();
    expect(render({ field: 'created_by', op: 'eq', value: '{{current_user}}' })).toEqual({
      sql: '"tasks"."created_by" = $1',
      params: [USER],
    });
  });

  it('coerces numbers and dates', () => {
    expect(render({ field: 'sequence_number', op: 'gt', value: '12' })).toEqual({
      sql: '"tasks"."sequence_number" > $1',
      params: [12],
    });
    expect(render({ field: 'due_date', op: 'lt', value: '2026-03-01T00:00:00Z' })).toEqual({
      sql: '"tasks"."due_date" < $1',
      params: ['2026-03-01T00:00:00.000Z'],
    });
    expect(render({ field: 'due_date', op: 'neq', value: '2026-03-01T00:00:00Z' })).toEqual({
      sql: '"tasks"."due_date" IS DISTINCT FROM $1',
      params: ['2026-03-01T00:00:00.000Z'],
    });
    expect(render({ field: 'due_date', op: 'lt', value: 'garbage' })).toBeNull();
  });
});

describe('FilterEngine operators on the joined state (task_states.category)', () => {
  const cases: OperatorCase[] = [
    { op: 'eq', value: 'done', sql: '"task_states"."category" = $1', params: ['done'] },
    { op: 'neq', value: 'done', sql: '"task_states"."category" IS DISTINCT FROM $1', params: ['done'] },
    { op: 'gt', value: 'b', sql: '"task_states"."category" > $1', params: ['b'] },
    { op: 'gte', value: 'b', sql: '"task_states"."category" >= $1', params: ['b'] },
    { op: 'lt', value: 'b', sql: '"task_states"."category" < $1', params: ['b'] },
    { op: 'lte', value: 'b', sql: '"task_states"."category" <= $1', params: ['b'] },
    { op: 'in', value: ['backlog'], sql: '"task_states"."category" in ($1)', params: ['backlog'] },
    {
      op: 'nin',
      value: ['done'],
      sql: '("task_states"."category" is null or "task_states"."category" not in ($1))',
      params: ['done'],
    },
    { op: 'contains', value: 'prog', sql: '"task_states"."category" like $1', params: ['%prog%'] },
    {
      op: 'not_contains',
      value: 'prog',
      sql: '("task_states"."category" is null or "task_states"."category" NOT LIKE $1)',
      params: ['%prog%'],
    },
    { op: 'starts_with', value: 'in', sql: '"task_states"."category" like $1', params: ['in%'] },
    { op: 'ends_with', value: 'ss', sql: '"task_states"."category" like $1', params: ['%ss'] },
    { op: 'is_null', value: null, sql: '"task_states"."category" is null', params: [] },
    { op: 'is_not_null', value: null, sql: '"task_states"."category" is not null', params: [] },
  ];

  for (const c of cases) {
    it(c.op, () => {
      expect(render({ field: 'state.category', op: c.op, value: c.value })).toEqual({ sql: c.sql, params: c.params });
    });
  }
});

describe('FilterEngine many-to-many fields use EXISTS', () => {
  const assigneeExists = (match: string) =>
    `EXISTS (SELECT 1 FROM "task_assignees" WHERE "task_assignees"."task_id" = "tasks"."id"${match})`;
  const labelExists = (match: string) =>
    `EXISTS (SELECT 1 FROM "task_labels" WHERE "task_labels"."task_id" = "tasks"."id"${match})`;

  const cases: (OperatorCase & { field: 'assignee_id' | 'label_id' })[] = [
    {
      field: 'assignee_id',
      op: 'eq',
      value: '{{current_user}}',
      sql: assigneeExists(' AND "task_assignees"."user_id" in ($1)'),
      params: [USER],
    },
    {
      field: 'assignee_id',
      op: 'neq',
      value: '{{current_user}}',
      sql: `NOT ${assigneeExists(' AND "task_assignees"."user_id" in ($1)')}`,
      params: [USER],
    },
    {
      field: 'assignee_id',
      op: 'in',
      value: [USER, OTHER],
      sql: assigneeExists(' AND "task_assignees"."user_id" in ($1, $2)'),
      params: [USER, OTHER],
    },
    {
      field: 'assignee_id',
      op: 'nin',
      value: [USER],
      sql: `NOT ${assigneeExists(' AND "task_assignees"."user_id" in ($1)')}`,
      params: [USER],
    },
    { field: 'assignee_id', op: 'is_null', value: null, sql: `NOT ${assigneeExists('')}`, params: [] },
    { field: 'assignee_id', op: 'is_not_null', value: null, sql: assigneeExists(''), params: [] },
    {
      field: 'label_id',
      op: 'eq',
      value: OTHER,
      sql: labelExists(' AND "task_labels"."label_id" in ($1)'),
      params: [OTHER],
    },
    {
      field: 'label_id',
      op: 'neq',
      value: OTHER,
      sql: `NOT ${labelExists(' AND "task_labels"."label_id" in ($1)')}`,
      params: [OTHER],
    },
    {
      field: 'label_id',
      op: 'in',
      value: [OTHER],
      sql: labelExists(' AND "task_labels"."label_id" in ($1)'),
      params: [OTHER],
    },
    {
      field: 'label_id',
      op: 'nin',
      value: [OTHER],
      sql: `NOT ${labelExists(' AND "task_labels"."label_id" in ($1)')}`,
      params: [OTHER],
    },
    { field: 'label_id', op: 'is_null', value: null, sql: `NOT ${labelExists('')}`, params: [] },
    { field: 'label_id', op: 'is_not_null', value: null, sql: labelExists(''), params: [] },
  ];

  for (const c of cases) {
    it(`${c.field} ${c.op}`, () => {
      expect(render({ field: c.field, op: c.op, value: c.value })).toEqual({ sql: c.sql, params: c.params });
    });
  }

  it('in with null also matches tasks without any assignee', () => {
    expect(render({ field: 'assignee_id', op: 'in', value: [USER, null] })?.sql).toBe(
      `(${assigneeExists(' AND "task_assignees"."user_id" in ($1)')} or NOT ${assigneeExists('')})`
    );
  });

  it('comparison and string operators are ignored on id sets', () => {
    for (const op of ['gt', 'gte', 'lt', 'lte', 'contains', 'not_contains', 'starts_with', 'ends_with'] as const) {
      expect(render({ field: 'assignee_id', op, value: USER })).toBeNull();
    }
  });

  it('no longer requires assignee/label joins', () => {
    const joins = FilterEngine.getRequiredJoins({
      operator: 'AND',
      conditions: [
        { field: 'assignee_id', op: 'eq', value: USER },
        { field: 'label_id', op: 'eq', value: OTHER },
        { operator: 'OR', conditions: [{ field: 'state.name', op: 'eq', value: 'Todo' }] },
      ],
    });
    expect([...joins]).toEqual(['task_states']);
  });
});

describe('FilterEngine AND/OR nesting', () => {
  it('collapses a single condition', () => {
    expect(render({ operator: 'OR', conditions: [{ field: 'priority', op: 'eq', value: 'high' }] })).toEqual({
      sql: '"tasks"."priority" = $1',
      params: ['high'],
    });
  });

  it('nests groups with parentheses', () => {
    const result = render({
      operator: 'AND',
      conditions: [
        { field: 'priority', op: 'eq', value: 'high' },
        {
          operator: 'OR',
          conditions: [
            { field: 'state.category', op: 'eq', value: 'backlog' },
            { field: 'state.category', op: 'eq', value: 'in_progress' },
          ],
        },
      ],
    });
    expect(result).toEqual({
      sql: '("tasks"."priority" = $1 and ("task_states"."category" = $2 or "task_states"."category" = $3))',
      params: ['high', 'backlog', 'in_progress'],
    });
  });

  it('drops ignored conditions and empty groups', () => {
    expect(
      render({
        operator: 'AND',
        conditions: [
          { field: 'nope', op: 'eq', value: 1 },
          { operator: 'OR', conditions: [] },
          { field: 'priority', op: 'is_null', value: null },
        ],
      })?.sql
    ).toBe('"tasks"."priority" is null');
    expect(render({ operator: 'AND', conditions: [] })).toBeNull();
  });
});

describe('FilterEngine date templates and timezones', () => {
  interface TzCase {
    timezone: string;
    now?: string;
    expected: Record<string, string>;
  }

  const tzCases: TzCase[] = [
    {
      timezone: 'UTC',
      expected: {
        '{{now}}': '2026-03-08T12:00:00.000Z',
        '{{start_of_day}}': '2026-03-08T00:00:00.000Z',
        '{{today}}': '2026-03-08T00:00:00.000Z',
        '{{end_of_day}}': '2026-03-08T23:59:59.999Z',
        '{{start_of_week}}': '2026-03-08T00:00:00.000Z',
        '{{end_of_week}}': '2026-03-14T23:59:59.999Z',
        '{{start_of_month}}': '2026-03-01T00:00:00.000Z',
        '{{end_of_month}}': '2026-03-31T23:59:59.999Z',
        '{{now + 1d}}': '2026-03-09T12:00:00.000Z',
        '{{now - 2h}}': '2026-03-08T10:00:00.000Z',
        '{{now + 1w}}': '2026-03-15T12:00:00.000Z',
        '{{now + 1m}}': '2026-04-08T12:00:00.000Z',
        '{{start_of_day - 1d}}': '2026-03-07T00:00:00.000Z',
      },
    },
    {
      timezone: 'America/New_York',
      expected: {
        '{{start_of_day}}': '2026-03-08T05:00:00.000Z', // midnight EST
        '{{end_of_day}}': '2026-03-09T03:59:59.999Z', // 23:59:59.999 EDT
        '{{start_of_week}}': '2026-03-08T05:00:00.000Z',
        '{{end_of_week}}': '2026-03-15T03:59:59.999Z',
        '{{start_of_month}}': '2026-03-01T05:00:00.000Z',
        '{{end_of_month}}': '2026-04-01T03:59:59.999Z',
        '{{now + 1d}}': '2026-03-09T12:00:00.000Z', // 08:00 EDT
        '{{now - 1d}}': '2026-03-07T13:00:00.000Z', // 08:00 EST: wall clock kept across DST
        '{{now - 2h}}': '2026-03-08T10:00:00.000Z', // absolute
        '{{now + 1w}}': '2026-03-15T12:00:00.000Z',
        '{{now + 1m}}': '2026-04-08T12:00:00.000Z',
        '{{start_of_day + 1d}}': '2026-03-09T04:00:00.000Z', // midnight EDT
      },
    },
    {
      timezone: 'Europe/Paris',
      expected: {
        '{{start_of_day}}': '2026-03-07T23:00:00.000Z',
        '{{end_of_day}}': '2026-03-08T22:59:59.999Z',
        '{{start_of_week}}': '2026-03-07T23:00:00.000Z',
        '{{end_of_week}}': '2026-03-14T22:59:59.999Z',
        '{{start_of_month}}': '2026-02-28T23:00:00.000Z',
        '{{end_of_month}}': '2026-03-31T21:59:59.999Z', // CEST from Mar 29
        '{{now + 1d}}': '2026-03-09T12:00:00.000Z',
        '{{now - 2h}}': '2026-03-08T10:00:00.000Z',
        '{{now + 1w}}': '2026-03-15T12:00:00.000Z',
        '{{now + 1m}}': '2026-04-08T11:00:00.000Z', // 13:00 CEST
      },
    },
    {
      timezone: 'Asia/Tokyo',
      expected: {
        '{{start_of_day}}': '2026-03-07T15:00:00.000Z',
        '{{end_of_day}}': '2026-03-08T14:59:59.999Z',
        '{{start_of_week}}': '2026-03-07T15:00:00.000Z',
        '{{end_of_week}}': '2026-03-14T14:59:59.999Z',
        '{{start_of_month}}': '2026-02-28T15:00:00.000Z',
        '{{end_of_month}}': '2026-03-31T14:59:59.999Z',
        '{{now + 1d}}': '2026-03-09T12:00:00.000Z',
        '{{now - 2h}}': '2026-03-08T10:00:00.000Z',
        '{{now + 1w}}': '2026-03-15T12:00:00.000Z',
        '{{now + 1m}}': '2026-04-08T12:00:00.000Z',
      },
    },
    {
      // Saturday evening in UTC is already Sunday in Tokyo: different week.
      timezone: 'Asia/Tokyo',
      now: '2026-03-07T20:00:00.000Z',
      expected: {
        '{{start_of_week}}': '2026-03-07T15:00:00.000Z',
        '{{start_of_day}}': '2026-03-07T15:00:00.000Z',
      },
    },
    {
      timezone: 'UTC',
      now: '2026-03-07T20:00:00.000Z',
      expected: { '{{start_of_week}}': '2026-03-01T00:00:00.000Z' },
    },
    {
      // Month arithmetic clamps the day.
      timezone: 'UTC',
      now: '2026-01-31T12:00:00.000Z',
      expected: { '{{now + 1m}}': '2026-02-28T12:00:00.000Z', '{{now - 2m}}': '2025-11-30T12:00:00.000Z' },
    },
  ];

  for (const c of tzCases) {
    describe(`${c.timezone} at ${c.now ?? NOW.toISOString()}`, () => {
      const context = FilterEngine.createContext(USER, {
        timezone: c.timezone,
        now: c.now ? new Date(c.now) : NOW,
      });
      for (const [template, iso] of Object.entries(c.expected)) {
        it(template, () => {
          expect(FilterEngine.resolveDateTemplate(template, context)?.toISOString()).toBe(iso);
        });
      }
    });
  }

  it('feeds resolved instants into SQL params', () => {
    const context = FilterEngine.createContext(USER, { timezone: 'America/New_York', now: NOW });
    const where = FilterEngine.buildWhereClause(
      { operator: 'AND', conditions: [{ field: 'due_date', op: 'lt', value: '{{end_of_day}}' }] },
      context
    );
    expect(toQuery(where)).toEqual({
      sql: '"tasks"."due_date" < $1',
      params: ['2026-03-09T03:59:59.999Z'],
    });
  });

  it('falls back to UTC for an invalid or missing timezone', () => {
    const bad = FilterEngine.createContext(USER, { timezone: 'Mars/Olympus_Mons', now: NOW });
    expect(bad.timezone).toBe('UTC');
    expect(bad.startOfWeek.toISOString()).toBe('2026-03-08T00:00:00.000Z');
    expect(FilterEngine.createContext(USER).timezone).toBe('UTC');
    // A legacy context without timezone resolves day templates in UTC.
    const { timezone: _tz, ...legacy } = FilterEngine.createContext(USER, { now: NOW });
    expect(FilterEngine.resolveDateTemplate('{{start_of_day}}', legacy)?.toISOString()).toBe(
      '2026-03-08T00:00:00.000Z'
    );
  });

  it('leaves non-templates and unknown templates alone', () => {
    expect(FilterEngine.resolveDateTemplate('2026-01-01', ctx)).toBeNull();
    expect(FilterEngine.resolveDateTemplate('{{yesterday}}', ctx)).toBeNull();
    expect(FilterEngine.resolveDateTemplate('{{now + 3x}}', ctx)).toBeNull();
    expect(render({ field: 'title', op: 'eq', value: '{{yesterday}}' })).toEqual({
      sql: '"tasks"."title" = $1',
      params: ['{{yesterday}}'],
    });
  });
});

describe('FilterEngine.validate', () => {
  it('accepts a valid nested filter', () => {
    expect(
      FilterEngine.validate({
        operator: 'AND',
        conditions: [
          { field: 'assignee_id', op: 'eq', value: '{{current_user}}' },
          { operator: 'OR', conditions: [{ field: 'due_date', op: 'lt', value: '{{now + 7d}}' }] },
        ],
      })
    ).toEqual({ valid: true, errors: [] });
  });

  it('reports unknown fields, operators and bad groups', () => {
    const filters = JSON.parse(
      '{"operator":"XOR","conditions":[{"field":"nope","op":"eq","value":1},{"field":"title","op":"regex","value":"x"},{"field":"","op":""}]}'
    );
    const result = FilterEngine.validate(filters);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      ': Invalid operator "XOR"',
      '[0]: unknown field "nope"',
      '[1]: unknown operator "regex"',
      '[2]: missing field',
      '[2]: missing operator',
    ]);
  });
});
