import { describe, expect, it } from 'bun:test';
import { resolveQueryTasksAssigneeId } from './mcp-tool-args.js';

describe('resolveQueryTasksAssigneeId', () => {
  it('resolves "me" to current user id', () => {
    const assigneeId = resolveQueryTasksAssigneeId({ assigneeId: 'me' }, 'user-123');
    expect(assigneeId).toBe('user-123');
  });

  it('returns normalized assignee id when provided', () => {
    const assigneeId = resolveQueryTasksAssigneeId({ assigneeId: '  user-456  ' }, 'user-123');
    expect(assigneeId).toBe('user-456');
  });

  it('returns undefined for empty assignee id', () => {
    const assigneeId = resolveQueryTasksAssigneeId({ assigneeId: '   ' }, 'user-123');
    expect(assigneeId).toBeUndefined();
  });

  it('rejects assignedId alias with clear message', () => {
    expect(() => resolveQueryTasksAssigneeId({ assignedId: 'me' }, 'user-123')).toThrow(
      'assignedId is not supported. Use assigneeId.'
    );
  });
});
