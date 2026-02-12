import { describe, expect, it } from 'bun:test';
import {
  resolveMcpLimit,
  resolveMcpTaskViewArgs,
  resolveMcpWriteReturnMode,
  resolveQueryTasksAssigneeId,
  resolveUpdateTaskGitHubPrArgs,
} from './mcp-tool-args.js';

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

describe('resolveUpdateTaskGitHubPrArgs', () => {
  it('returns null when no pull request arguments are provided', () => {
    const args = resolveUpdateTaskGitHubPrArgs({});
    expect(args).toBeNull();
  });

  it('parses and normalizes pull request arguments', () => {
    const args = resolveUpdateTaskGitHubPrArgs({
      githubPrOwner: '  flowful-ai  ',
      githubPrRepo: '  tasksflow ',
      githubPrNumber: '42',
    });
    expect(args).toEqual({
      owner: 'flowful-ai',
      repo: 'tasksflow',
      prNumber: 42,
    });
  });

  it('throws when pull request arguments are incomplete', () => {
    expect(() =>
      resolveUpdateTaskGitHubPrArgs({
        githubPrOwner: 'flowful-ai',
      })
    ).toThrow('githubPrRepo is required when linking a pull request');
  });

  it('throws when pull request number is not a positive integer', () => {
    expect(() =>
      resolveUpdateTaskGitHubPrArgs({
        githubPrOwner: 'flowful-ai',
        githubPrRepo: 'tasksflow',
        githubPrNumber: 0,
      })
    ).toThrow('githubPrNumber must be a positive integer when linking a pull request');
  });
});

describe('resolveMcpTaskViewArgs', () => {
  it('defaults to compact view and relation includes disabled', () => {
    expect(resolveMcpTaskViewArgs({})).toEqual({
      view: 'compact',
      fields: undefined,
      includeAssignees: false,
      includeLabels: false,
      includeExternalLinks: false,
    });
  });

  it('requires fields for custom view', () => {
    expect(() => resolveMcpTaskViewArgs({ view: 'custom' })).toThrow(
      'fields is required when view is custom'
    );
  });

  it('rejects fields for non-custom views', () => {
    expect(() => resolveMcpTaskViewArgs({ view: 'compact', fields: ['id'] })).toThrow(
      'fields is only supported when view is custom'
    );
  });

  it('normalizes custom fields and include flags', () => {
    expect(resolveMcpTaskViewArgs({
      view: 'custom',
      fields: [' title ', 'stateId', 'title'],
      includeAssignees: true,
      includeLabels: 'false',
      includeExternalLinks: 'true',
    })).toEqual({
      view: 'custom',
      fields: ['title', 'stateId'],
      includeAssignees: true,
      includeLabels: false,
      includeExternalLinks: true,
    });
  });
});

describe('resolveMcpWriteReturnMode', () => {
  it('defaults to ack', () => {
    expect(resolveMcpWriteReturnMode({})).toBe('ack');
  });

  it('accepts compact and full', () => {
    expect(resolveMcpWriteReturnMode({ return: 'compact' })).toBe('compact');
    expect(resolveMcpWriteReturnMode({ return: 'full' })).toBe('full');
  });

  it('rejects unknown mode', () => {
    expect(() => resolveMcpWriteReturnMode({ return: 'verbose' })).toThrow(
      'return must be one of: ack, compact, full'
    );
  });
});

describe('resolveMcpLimit', () => {
  it('defaults to 10 when missing or invalid', () => {
    expect(resolveMcpLimit({})).toBe(10);
    expect(resolveMcpLimit({ limit: 'oops' })).toBe(10);
    expect(resolveMcpLimit({ limit: 0 })).toBe(10);
  });

  it('clamps to max 50', () => {
    expect(resolveMcpLimit({ limit: '200' })).toBe(50);
    expect(resolveMcpLimit({ limit: 20 })).toBe(20);
  });
});
