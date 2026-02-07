import { eq, and, or, gt, gte, lt, lte, inArray, notInArray, like, isNull, isNotNull, SQL, sql } from 'drizzle-orm';

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}
import type { PgColumn } from 'drizzle-orm/pg-core';
import { tasks, taskStates, taskAssignees, taskLabels } from '@flowtask/database';
import type { FilterGroup, FilterCondition, FilterOperator } from '@flowtask/shared';
import type { FilterContext } from './types.js';

// Template variable patterns
const TEMPLATE_PATTERNS = {
  '{{current_user}}': (ctx: FilterContext) => ctx.currentUserId,
  '{{now}}': (ctx: FilterContext) => ctx.now,
  '{{start_of_week}}': (ctx: FilterContext) => ctx.startOfWeek,
  '{{end_of_week}}': (ctx: FilterContext) => ctx.endOfWeek,
  '{{start_of_month}}': (ctx: FilterContext) => ctx.startOfMonth,
  '{{end_of_month}}': (ctx: FilterContext) => ctx.endOfMonth,
} as const;

// Parse relative date expressions like "{{now + 7d}}"
function parseRelativeDate(template: string, ctx: FilterContext): Date | null {
  const match = template.match(/\{\{now\s*([+-])\s*(\d+)([dhwm])\}\}/);
  if (!match) return null;

  const [, operator, amount, unit] = match;
  const num = parseInt(amount!, 10);
  const multiplier = operator === '+' ? 1 : -1;

  const date = new Date(ctx.now);
  switch (unit) {
    case 'd':
      date.setDate(date.getDate() + num * multiplier);
      break;
    case 'h':
      date.setHours(date.getHours() + num * multiplier);
      break;
    case 'w':
      date.setDate(date.getDate() + num * 7 * multiplier);
      break;
    case 'm':
      date.setMonth(date.getMonth() + num * multiplier);
      break;
  }

  return date;
}

// Resolve template variables in a value
function resolveValue(value: unknown, ctx: FilterContext): unknown {
  if (typeof value === 'string') {
    // Check for direct template match
    if (value in TEMPLATE_PATTERNS) {
      return TEMPLATE_PATTERNS[value as keyof typeof TEMPLATE_PATTERNS](ctx);
    }

    // Check for relative date expression
    if (value.startsWith('{{now')) {
      const date = parseRelativeDate(value, ctx);
      if (date) return date;
    }
  }

  // Recursively resolve arrays
  if (Array.isArray(value)) {
    return value.map((v) => resolveValue(v, ctx));
  }

  return value;
}

// Join field type
interface JoinField {
  table: string;
  column: string;
}

// Type guard for join fields
function isJoinField(mapping: PgColumn | JoinField): mapping is JoinField {
  return 'table' in mapping && 'column' in mapping && typeof mapping.table === 'string';
}

// Field mapping from filter field names to database columns
const FIELD_MAP: Record<string, PgColumn | JoinField> = {
  id: tasks.id,
  project_id: tasks.projectId,
  state_id: tasks.stateId,
  title: tasks.title,
  description: tasks.description,
  priority: tasks.priority,
  due_date: tasks.dueDate,
  start_date: tasks.startDate,
  created_at: tasks.createdAt,
  updated_at: tasks.updatedAt,
  created_by: tasks.createdBy,
  sequence_number: tasks.sequenceNumber,
  // Special fields that require joins
  'state.category': { table: 'task_states', column: 'category' },
  'state.name': { table: 'task_states', column: 'name' },
  assignee_id: { table: 'task_assignees', column: 'user_id' },
  label_id: { table: 'task_labels', column: 'label_id' },
};

// Get the database column for a field
function getColumn(field: string): PgColumn | null {
  const mapping = FIELD_MAP[field];
  if (!mapping) return null;

  if (isJoinField(mapping)) {
    // Handle joined fields
    switch (mapping.table) {
      case 'task_states':
        return mapping.column === 'category' ? taskStates.category : taskStates.name;
      case 'task_assignees':
        return taskAssignees.userId;
      case 'task_labels':
        return taskLabels.labelId;
    }
    return null;
  }

  return mapping;
}

// Build SQL condition from a filter condition
function buildCondition(condition: FilterCondition, ctx: FilterContext): SQL | null {
  const column = getColumn(condition.field);
  if (!column) {
    console.warn(`Unknown filter field: ${condition.field}`);
    return null;
  }

  const value = resolveValue(condition.value, ctx);

  switch (condition.op) {
    case 'eq':
      return eq(column, value as string | number);
    case 'neq':
      return sql`${column} != ${value}`;
    case 'gt':
      return gt(column, value as string | number | Date);
    case 'gte':
      return gte(column, value as string | number | Date);
    case 'lt':
      return lt(column, value as string | number | Date);
    case 'lte':
      return lte(column, value as string | number | Date);
    case 'in':
      if (!Array.isArray(value) || value.length === 0) return null;
      return inArray(column, value as string[]);
    case 'nin':
      if (!Array.isArray(value) || value.length === 0) return null;
      return notInArray(column, value as string[]);
    case 'contains':
      return like(column, `%${escapeLike(String(value))}%`);
    case 'not_contains':
      return sql`${column} NOT LIKE ${`%${escapeLike(String(value))}%`}`;
    case 'starts_with':
      return like(column, `${escapeLike(String(value))}%`);
    case 'ends_with':
      return like(column, `%${escapeLike(String(value))}`);
    case 'is_null':
      return isNull(column);
    case 'is_not_null':
      return isNotNull(column);
    default:
      console.warn(`Unknown filter operator: ${condition.op}`);
      return null;
  }
}

// Check if a condition is a filter group
function isFilterGroup(condition: FilterCondition | FilterGroup): condition is FilterGroup {
  return 'operator' in condition && 'conditions' in condition;
}

// Build SQL conditions from a filter group
function buildGroupConditions(group: FilterGroup, ctx: FilterContext): SQL | null {
  const conditions: SQL[] = [];

  for (const item of group.conditions) {
    let condition: SQL | null;

    if (isFilterGroup(item)) {
      condition = buildGroupConditions(item, ctx);
    } else {
      condition = buildCondition(item, ctx);
    }

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
   * Create a filter context with the current user and date values.
   */
  static createContext(userId: string): FilterContext {
    const now = new Date();

    // Calculate start of week (Sunday)
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    // Calculate end of week (Saturday)
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    // Calculate start of month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Calculate end of month
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    return {
      currentUserId: userId,
      now,
      startOfWeek,
      endOfWeek,
      startOfMonth,
      endOfMonth,
    };
  }

  /**
   * Build SQL WHERE clause from a filter configuration.
   */
  static buildWhereClause(filters: FilterGroup, ctx: FilterContext): SQL | null {
    return buildGroupConditions(filters, ctx);
  }

  /**
   * Check which tables need to be joined based on filter fields.
   */
  static getRequiredJoins(filters: FilterGroup): Set<'task_states' | 'task_assignees' | 'task_labels'> {
    const joins = new Set<'task_states' | 'task_assignees' | 'task_labels'>();

    function checkConditions(group: FilterGroup) {
      for (const item of group.conditions) {
        if (isFilterGroup(item)) {
          checkConditions(item);
        } else {
          const field = item.field;
          if (field.startsWith('state.')) {
            joins.add('task_states');
          } else if (field === 'assignee_id') {
            joins.add('task_assignees');
          } else if (field === 'label_id') {
            joins.add('task_labels');
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
        errors.push(`${path}: Invalid operator "${group.operator}"`);
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
