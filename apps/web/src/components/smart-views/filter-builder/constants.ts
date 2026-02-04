import type { FilterOperator } from '@flowtask/shared';

export type FilterFieldType =
  | 'text'
  | 'priority'
  | 'state_category'
  | 'date'
  | 'user'
  | 'label'
  | 'number';

export interface FilterFieldDefinition {
  label: string;
  type: FilterFieldType;
  category: string;
}

export const FILTER_FIELDS: Record<string, FilterFieldDefinition> = {
  // Task Properties
  title: { label: 'Title', type: 'text', category: 'Task' },
  description: { label: 'Description', type: 'text', category: 'Task' },
  priority: { label: 'Priority', type: 'priority', category: 'Task' },
  sequence_number: { label: 'Sequence #', type: 'number', category: 'Task' },

  // Status
  'state.category': { label: 'State Category', type: 'state_category', category: 'Status' },

  // Dates
  due_date: { label: 'Due Date', type: 'date', category: 'Dates' },
  start_date: { label: 'Start Date', type: 'date', category: 'Dates' },
  created_at: { label: 'Created', type: 'date', category: 'Dates' },

  // People
  assignee_id: { label: 'Assignee', type: 'user', category: 'People' },
  created_by: { label: 'Created By', type: 'user', category: 'People' },

  // Organization
  label_id: { label: 'Label', type: 'label', category: 'Organization' },
};

export const OPERATORS_BY_TYPE: Record<FilterFieldType, FilterOperator[]> = {
  text: ['contains', 'not_contains', 'eq', 'neq', 'is_null', 'is_not_null'],
  priority: ['eq', 'neq', 'in', 'nin', 'is_null', 'is_not_null'],
  state_category: ['eq', 'neq', 'in', 'nin'],
  date: ['eq', 'lt', 'lte', 'gt', 'gte', 'is_null', 'is_not_null'],
  user: ['eq', 'neq', 'in', 'nin', 'is_null', 'is_not_null'],
  label: ['eq', 'in', 'nin', 'is_null', 'is_not_null'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
};

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is after',
  gte: 'is on or after',
  lt: 'is before',
  lte: 'is on or before',
  in: 'is any of',
  nin: 'is none of',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  is_null: 'is empty',
  is_not_null: 'is not empty',
};

// Context-aware labels for different field types
export const OPERATOR_LABELS_BY_TYPE: Partial<Record<FilterFieldType, Partial<Record<FilterOperator, string>>>> = {
  date: {
    eq: 'is',
    gt: 'is after',
    gte: 'is on or after',
    lt: 'is before',
    lte: 'is on or before',
  },
  number: {
    eq: 'equals',
    neq: 'does not equal',
    gt: 'is greater than',
    gte: 'is at least',
    lt: 'is less than',
    lte: 'is at most',
  },
};

export const DATE_TEMPLATES = [
  { value: '{{now}}', label: 'Today' },
  { value: '{{now + 1d}}', label: 'Tomorrow' },
  { value: '{{now + 7d}}', label: 'In 7 days' },
  { value: '{{now - 7d}}', label: '7 days ago' },
  { value: '{{end_of_week}}', label: 'End of this week' },
  { value: '{{end_of_month}}', label: 'End of this month' },
];

export const USER_TEMPLATES = [
  { value: '{{current_user}}', label: 'Current user (me)' },
];

export const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent', color: '#dc2626' },
  { value: 'high', label: 'High', color: '#ea580c' },
  { value: 'medium', label: 'Medium', color: '#ca8a04' },
  { value: 'low', label: 'Low', color: '#16a34a' },
  { value: 'none', label: 'None', color: '#6b7280' },
];

// Get all field categories for grouped display
export function getFieldsByCategory(): Record<string, { field: string; definition: FilterFieldDefinition }[]> {
  const categories: Record<string, { field: string; definition: FilterFieldDefinition }[]> = {};

  for (const [field, definition] of Object.entries(FILTER_FIELDS)) {
    if (!categories[definition.category]) {
      categories[definition.category] = [];
    }
    categories[definition.category].push({ field, definition });
  }

  return categories;
}

// Check if an operator requires a value input
export function operatorRequiresValue(operator: FilterOperator): boolean {
  return operator !== 'is_null' && operator !== 'is_not_null';
}

// Check if an operator supports multiple values
export function operatorSupportsMultiple(operator: FilterOperator): boolean {
  return operator === 'in' || operator === 'nin';
}

// Get the label for an operator, with field-type-specific overrides
export function getOperatorLabel(operator: FilterOperator, fieldType: FilterFieldType): string {
  const typeSpecific = OPERATOR_LABELS_BY_TYPE[fieldType];
  if (typeSpecific && typeSpecific[operator]) {
    return typeSpecific[operator];
  }
  return OPERATOR_LABELS[operator];
}
