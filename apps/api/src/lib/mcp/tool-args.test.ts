import { describe, expect, it } from 'bun:test';
import {
  parseDueDate,
  resolveMcpTaskViewArgs,
  resolveMcpWriteReturnMode,
  resolveUpdateTaskGitHubPrArgs,
} from './tool-args.js';
import { ToolExecutionError } from './errors.js';

describe('resolveUpdateTaskGitHubPrArgs', () => {
  it('returns null when no pull request arguments are provided', () => {
    expect(resolveUpdateTaskGitHubPrArgs({ taskId: 'task-1' })).toBeNull();
  });

  it('parses and normalizes pull request arguments', () => {
    expect(
      resolveUpdateTaskGitHubPrArgs({
        githubPrOwner: '  octo ',
        githubPrRepo: ' repo ',
        githubPrNumber: 42,
      })
    ).toEqual({ owner: 'octo', repo: 'repo', prNumber: 42 });
  });

  it('throws a model-visible error when pull request arguments are incomplete', () => {
    expect(() => resolveUpdateTaskGitHubPrArgs({ githubPrOwner: 'octo' })).toThrow(
      ToolExecutionError
    );
    expect(() => resolveUpdateTaskGitHubPrArgs({ githubPrOwner: 'octo' })).toThrow(
      'githubPrRepo is required'
    );
  });

  it('throws when pull request number is not a positive integer', () => {
    expect(() =>
      resolveUpdateTaskGitHubPrArgs({
        githubPrOwner: 'octo',
        githubPrRepo: 'repo',
        githubPrNumber: 0,
      })
    ).toThrow('githubPrNumber must be a positive integer');
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
    expect(
      resolveMcpTaskViewArgs({
        view: 'custom',
        fields: [' id ', 'title', 'id'],
        includeAssignees: true,
      })
    ).toEqual({
      view: 'custom',
      fields: ['id', 'title'],
      includeAssignees: true,
      includeLabels: false,
      includeExternalLinks: false,
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
    expect(() => resolveMcpWriteReturnMode({ return: 'everything' })).toThrow(ToolExecutionError);
  });
});

describe('parseDueDate', () => {
  it('treats date-only values as midnight UTC', () => {
    expect(parseDueDate('2026-12-01').toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('accepts ISO datetimes', () => {
    expect(parseDueDate('2026-12-01T15:30:00+02:00').toISOString()).toBe(
      '2026-12-01T13:30:00.000Z'
    );
  });

  it('rejects garbage with a model-visible error', () => {
    expect(() => parseDueDate('next friday')).toThrow(ToolExecutionError);
  });
});
