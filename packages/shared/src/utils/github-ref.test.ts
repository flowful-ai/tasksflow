import { describe, expect, it } from 'bun:test';
import { githubLinkLabel } from './github-ref.js';

describe('githubLinkLabel', () => {
  it('shows #N short and owner/repo#N full for v2 ids', () => {
    expect(githubLinkLabel({ externalId: 'flowful-ai/vectoria#5' })).toEqual({
      short: '#5',
      full: 'flowful-ai/vectoria#5',
    });
  });

  it('falls back to the URL for bare legacy ids', () => {
    expect(
      githubLinkLabel({
        externalId: '953',
        externalUrl: 'https://github.com/flowful-ai/vectoria/pull/953',
      })
    ).toEqual({ short: '#953', full: 'flowful-ai/vectoria#953' });
  });

  it('never doubles the hash', () => {
    expect(githubLinkLabel({ externalId: '#12' }).short).toBe('#12');
  });
});
