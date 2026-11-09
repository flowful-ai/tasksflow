// ============ GitHub external ids ============

export interface GitHubItemRef {
  owner: string;
  repo: string;
  number: number;
}

/**
 * External id for a GitHub issue/PR link: `owner/repo#N`, lower-cased.
 * Issue numbers are only unique per repository, so the repo is part of the id.
 */
export function formatGitHubExternalId(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`.toLowerCase();
}

const EXTERNAL_ID_PATTERN = /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/;

export function parseGitHubExternalId(externalId: string): GitHubItemRef | null {
  const match = EXTERNAL_ID_PATTERN.exec(externalId);
  if (!match || !match[1] || !match[2] || !match[3]) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pull)\/(\d+)/;

export function parseGitHubItemUrl(
  url: string
): (GitHubItemRef & { kind: 'issue' | 'pull' }) | null {
  const match = GITHUB_URL_PATTERN.exec(url);
  if (!match || !match[1] || !match[2] || !match[3] || !match[4]) return null;
  return {
    owner: match[1],
    repo: match[2],
    kind: match[3] === 'pull' ? 'pull' : 'issue',
    number: Number(match[4]),
  };
}

/** Resolve a link's repo and number from its external id, falling back to its URL. */
export function resolveGitHubLinkRef(link: {
  externalId: string;
  externalUrl: string;
}): GitHubItemRef | null {
  const fromId = parseGitHubExternalId(link.externalId);
  if (fromId) return fromId;
  const fromUrl = parseGitHubItemUrl(link.externalUrl);
  return fromUrl ? { owner: fromUrl.owner, repo: fromUrl.repo, number: fromUrl.number } : null;
}

/**
 * Display label for a GitHub link: `#N` for compact chips, plus the full
 * `owner/repo#N` for tooltips and screen readers. Falls back to the raw id.
 */
export function githubLinkLabel(link: { externalId: string; externalUrl?: string }): {
  short: string;
  full: string;
} {
  const ref =
    parseGitHubExternalId(link.externalId) ??
    (link.externalUrl ? parseGitHubItemUrl(link.externalUrl) : null);
  if (!ref) {
    const raw = link.externalId.replace(/^#/, '');
    return { short: `#${raw}`, full: `#${raw}` };
  }
  return { short: `#${ref.number}`, full: `${ref.owner}/${ref.repo}#${ref.number}` };
}
