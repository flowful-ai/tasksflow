import { describe, expect, it } from 'bun:test';
import { smartViewUsesCurrentUserTemplate } from './smart-view-query-utils.js';
import type { FilterGroup } from '@flowtask/shared';

describe('smartViewUsesCurrentUserTemplate', () => {
  it('returns true for direct current user filter value', () => {
    const filters: FilterGroup = {
      operator: 'AND',
      conditions: [{ field: 'assignee_id', op: 'eq', value: '{{current_user}}' }],
    };

    expect(smartViewUsesCurrentUserTemplate(filters)).toBe(true);
  });

  it('returns true for nested current user values in arrays', () => {
    const filters: FilterGroup = {
      operator: 'AND',
      conditions: [
        {
          operator: 'OR',
          conditions: [
            { field: 'assignee_id', op: 'in', value: ['user-1', '{{current_user}}'] },
            { field: 'priority', op: 'eq', value: 'high' },
          ],
        },
      ],
    };

    expect(smartViewUsesCurrentUserTemplate(filters)).toBe(true);
  });

  it('returns false when current user template is not present', () => {
    const filters: FilterGroup = {
      operator: 'AND',
      conditions: [{ field: 'priority', op: 'in', value: ['high', 'urgent'] }],
    };

    expect(smartViewUsesCurrentUserTemplate(filters)).toBe(false);
  });
});
