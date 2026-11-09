import { describe, expect, test } from 'bun:test';
import { assignOperation, describeBulkSummary, resolveCancelStateId, resolveDoneStateId, setLabelsOperation } from './bulk';

const states = [
  { id: 'b', name: 'Backlog', category: 'backlog' },
  { id: 'c', name: 'Cancelled', category: 'done' },
  { id: 'd', name: 'Done', category: 'done' },
];

describe('bulk helpers', () => {
  test('done / cancel state resolution', () => {
    expect(resolveDoneStateId(states)).toBe('d');
    expect(resolveDoneStateId([{ id: 'x', name: 'Shipped', category: 'done' }])).toBe('x');
    expect(resolveCancelStateId(states)).toBe('c');
    expect(resolveDoneStateId([states[0]])).toBeNull();
  });

  test('assign: add vs replace', () => {
    expect(assignOperation('u1', 'add', ['u2'])).toEqual({ addAssigneeIds: ['u1'] });
    expect(assignOperation('u1', 'replace', ['u2', 'u1', 'u2'])).toEqual({ addAssigneeIds: ['u1'], removeAssigneeIds: ['u2'] });
    expect(assignOperation('u1', 'replace', ['u1'])).toEqual({ addAssigneeIds: ['u1'] });
  });

  test('set labels adds the chosen ones and removes the rest', () => {
    expect(setLabelsOperation(['a'], ['a', 'b', 'b'])).toEqual({ addLabelIds: ['a'], removeLabelIds: ['b'] });
    expect(setLabelsOperation([], [])).toEqual({});
  });

  test('summary text and level', () => {
    expect(describeBulkSummary('Delete', { updated: 3, unchanged: 0, failed: 0, results: [] })).toEqual({
      level: 'success',
      message: 'Delete: 3 updated.',
    });
    expect(describeBulkSummary('Assign', { updated: 1, unchanged: 1, failed: 1, results: [] }).level).toBe('error');
  });
});
