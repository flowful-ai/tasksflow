import { describe, expect, test } from 'bun:test';
import { buildTaskNotificationMessage } from '../slack/notify.js';
import { computeIssueSyncHash } from './sync-hash.js';
import { issueContentFrom, mapLabelsToPriority, parseGitHubWebhook } from './webhook.js';

const repository = { id: 1, name: 'api', full_name: 'acme/api', owner: { login: 'acme' } };
const sender = { login: 'octocat', id: 9 };
const issue = {
  id: 100,
  number: 12,
  title: 'Bug',
  body: 'It breaks',
  html_url: 'https://github.com/acme/api/issues/12',
  state: 'open',
  labels: [{ name: 'p1' }],
};

describe('parseGitHubWebhook', () => {
  test('classifies issue events with their installation', () => {
    expect(
      parseGitHubWebhook('issues', {
        action: 'opened',
        issue,
        repository,
        sender,
        installation: { id: 5 },
      })
    ).toEqual({
      kind: 'issue',
      action: 'opened',
      repo: { owner: 'acme', repo: 'api' },
      installationId: 5,
      issueNumber: 12,
      createdByAppId: null,
    });
  });

  test('flags issues created by a GitHub App', () => {
    const result = parseGitHubWebhook('issues', {
      action: 'opened',
      issue: { ...issue, performed_via_github_app: { id: 321 } },
      repository,
      sender,
    });
    expect(result.kind === 'issue' && result.createdByAppId).toBe(321);
  });

  test('ignores issue events that describe pull requests', () => {
    const result = parseGitHubWebhook('issues', {
      action: 'edited',
      issue: { ...issue, pull_request: { url: 'x' } },
      repository,
      sender,
    });
    expect(result.kind).toBe('ignore');
  });

  test('classifies merged pull requests without turning the PR number into an issue', () => {
    const result = parseGitHubWebhook('pull_request', {
      action: 'closed',
      pull_request: {
        id: 1,
        number: 40,
        title: 'FLOW-3 login',
        body: null,
        html_url: 'https://github.com/acme/api/pull/40',
        state: 'closed',
        merged: true,
        head: { ref: 'feature/flow-3' },
      },
      repository,
      sender,
      installation: { id: 5 },
    });
    expect(result).toMatchObject({
      kind: 'pull_request',
      action: 'closed',
      pr: { number: 40, merged: true, branch: 'feature/flow-3' },
    });
  });

  test('marks comments posted by an app', () => {
    const result = parseGitHubWebhook('issue_comment', {
      action: 'created',
      comment: {
        id: 77,
        body: 'hi',
        html_url: 'https://github.com/acme/api/issues/12#issuecomment-77',
        user: { login: 'flowtask[bot]', id: 1, type: 'Bot' },
        performed_via_github_app: { id: 321 },
      },
      issue: { number: 12, html_url: issue.html_url },
      repository,
      sender,
    });
    expect(result).toMatchObject({ kind: 'issue_comment', comment: { id: '77', viaAppId: 321 } });
  });

  test('ignores malformed payloads and unknown events', () => {
    expect(parseGitHubWebhook('issues', { action: 'opened' }).kind).toBe('ignore');
    expect(parseGitHubWebhook('issues', null).kind).toBe('ignore');
    expect(parseGitHubWebhook('push', { repository }).kind).toBe('ignore');
  });
});

describe('sync hash', () => {
  const base = issueContentFrom(issue);

  test('is stable across label order, case and line endings', () => {
    const same = { ...base, body: 'It breaks\r\n', labels: ['P1'] };
    expect(computeIssueSyncHash(same)).toBe(computeIssueSyncHash(base));
  });

  test('changes on any genuine edit', () => {
    const baseHash = computeIssueSyncHash(base);
    expect(computeIssueSyncHash({ ...base, title: 'Bug!' })).not.toBe(baseHash);
    expect(computeIssueSyncHash({ ...base, state: 'closed' })).not.toBe(baseHash);
    expect(computeIssueSyncHash({ ...base, labels: ['p0'] })).not.toBe(baseHash);
  });

  test('maps priority labels', () => {
    expect(mapLabelsToPriority(['P0'])).toBe('urgent');
    expect(mapLabelsToPriority([{ name: 'priority:low' }])).toBe('low');
    expect(mapLabelsToPriority([{ name: 'bug' }])).toBeNull();
  });
});

describe('Slack task message', () => {
  test('escapes titles so they cannot inject links or mentions', () => {
    const message = buildTaskNotificationMessage({
      taskId: 't',
      taskTitle: '<!channel> <https://evil|click>',
      taskUrl: 'https://flowtask.test/task/t',
      projectName: 'Core',
      taskKey: 'FLOW-1',
      action: 'created',
    });
    expect(message.text).not.toContain('<!channel>');
    expect(JSON.stringify(message.blocks)).toContain('&lt;!channel&gt;');
  });
});
