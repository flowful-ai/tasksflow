import { describe, expect, test } from 'bun:test';
import {
  findInstallationForRepo,
  findLinkedRepository,
  formatGitHubExternalId,
  parseGitHubConfig,
  parseGitHubExternalId,
  parseGitHubItemUrl,
  parseTaskReferences,
  resolveGitHubLinkRef,
} from './integration.js';

describe('parseGitHubConfig', () => {
  test('parses the canonical shape', () => {
    const config = parseGitHubConfig({
      repositories: [{ owner: 'acme', repo: 'api', installationId: 11, linkedAt: '2026-01-01', syncStatus: 'idle' }],
    });
    expect(config.repositories).toHaveLength(1);
    expect(config.repositories[0]).toMatchObject({ owner: 'acme', repo: 'api', installationId: 11 });
  });

  test('repository entries inherit a legacy top-level installationId', () => {
    const config = parseGitHubConfig({ installationId: 7, repositories: [{ owner: 'acme', repo: 'web' }] });
    expect(config.repositories[0]?.installationId).toBe(7);
  });

  test('normalizes the legacy top-level owner/repo shape', () => {
    const config = parseGitHubConfig({ owner: 'acme', repo: 'legacy', installationId: '42' });
    expect(config.repositories).toEqual([
      expect.objectContaining({ owner: 'acme', repo: 'legacy', installationId: 42 }),
    ]);
  });

  test('drops malformed entries and entries without any installation', () => {
    const config = parseGitHubConfig({
      repositories: [{ owner: 'acme' }, { owner: 'acme', repo: 'no-install' }, 'junk', { owner: 'a', repo: 'b', installationId: 3 }],
    });
    expect(config.repositories.map((r) => r.repo)).toEqual(['b']);
  });

  test('returns no repositories for invalid input', () => {
    expect(parseGitHubConfig(null).repositories).toEqual([]);
    expect(parseGitHubConfig('nope').repositories).toEqual([]);
    expect(parseGitHubConfig({ repositories: 'nope' }).repositories).toEqual([]);
  });
});

describe('findInstallationForRepo', () => {
  const config = parseGitHubConfig({
    installationId: 99,
    repositories: [
      { owner: 'Acme', repo: 'API', installationId: 11 },
      { owner: 'acme', repo: 'web', installationId: 12 },
    ],
  });

  test('matches the exact repository (case-insensitively, like GitHub)', () => {
    expect(findInstallationForRepo(config, 'acme', 'api')).toBe(11);
    expect(findInstallationForRepo(config, 'ACME', 'Web')).toBe(12);
  });

  test('never falls back to another installation for an unlinked repo', () => {
    expect(findInstallationForRepo(config, 'acme', 'secret')).toBeNull();
    expect(findInstallationForRepo(config, 'victim', 'api')).toBeNull();
    expect(findLinkedRepository(config, 'acme', 'ap')).toBeNull();
  });
});

describe('GitHub external ids', () => {
  test('round-trips owner/repo#N', () => {
    const id = formatGitHubExternalId('Acme', 'API', 12);
    expect(id).toBe('acme/api#12');
    expect(parseGitHubExternalId(id)).toEqual({ owner: 'acme', repo: 'api', number: 12 });
  });

  test('issue numbers in different repos produce different ids', () => {
    expect(formatGitHubExternalId('acme', 'api', 1)).not.toBe(formatGitHubExternalId('acme', 'web', 1));
  });

  test('rejects legacy bare numbers', () => {
    expect(parseGitHubExternalId('12')).toBeNull();
  });

  test('parses issue and PR URLs', () => {
    expect(parseGitHubItemUrl('https://github.com/acme/api/issues/5')).toEqual({ owner: 'acme', repo: 'api', kind: 'issue', number: 5 });
    expect(parseGitHubItemUrl('https://github.com/acme/api/pull/6')).toEqual({ owner: 'acme', repo: 'api', kind: 'pull', number: 6 });
    expect(parseGitHubItemUrl('https://example.com/acme/api/issues/5')).toBeNull();
  });

  test('resolveGitHubLinkRef falls back to the URL for legacy links', () => {
    expect(resolveGitHubLinkRef({ externalId: '5', externalUrl: 'https://github.com/acme/api/issues/5' })).toEqual({
      owner: 'acme',
      repo: 'api',
      number: 5,
    });
  });
});

describe('parseTaskReferences', () => {
  test('finds references in titles and bodies', () => {
    expect(parseTaskReferences('Fix FLOW-123 and FLOW-7 (see API-42)')).toEqual([
      { identifier: 'FLOW', sequenceNumber: 123 },
      { identifier: 'FLOW', sequenceNumber: 7 },
      { identifier: 'API', sequenceNumber: 42 },
    ]);
  });

  test('finds references in branch names, case-insensitively', () => {
    expect(parseTaskReferences('feature/flow-123-login-fix')).toEqual([{ identifier: 'FLOW', sequenceNumber: 123 }]);
  });

  test('deduplicates', () => {
    expect(parseTaskReferences('FLOW-1 flow-1 FLOW-1')).toEqual([{ identifier: 'FLOW', sequenceNumber: 1 }]);
  });

  test('ignores parts of longer tokens and zero sequence numbers', () => {
    expect(parseTaskReferences('xFLOW-12y FLOW-0 TOOLONGIDENT1-5')).toEqual([]);
  });

  test('returns numbers, never raw strings for uuid columns', () => {
    const [ref] = parseTaskReferences('FLOW-123');
    expect(typeof ref?.sequenceNumber).toBe('number');
  });

  test('caps the number of references', () => {
    const text = Array.from({ length: 50 }, (_, i) => `FLOW-${i + 1}`).join(' ');
    expect(parseTaskReferences(text)).toHaveLength(20);
  });
});
