import { describe, expect, it } from 'bun:test';
import { resolveQueryTasksAssigneeId, resolveUpdateTaskGitHubPrArgs } from './mcp-tool-args.js';

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
