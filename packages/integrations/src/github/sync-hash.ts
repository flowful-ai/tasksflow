import { createHash } from 'crypto';
import type { IssueContent } from './webhook.js';

/**
 * Hash of the issue content FlowTask last exchanged with GitHub.
 *
 * Stored on the external link after every sync in either direction. An
 * incoming webhook whose fresh issue content hashes to the stored value is an
 * echo of our own write (or a no-op) and is skipped. Any real change on GitHub
 * produces a different hash and is applied, unlike the old time-window guard
 * that dropped genuine edits made within 5 seconds of a sync.
 */
export function computeIssueSyncHash(content: IssueContent): string {
  const normalized = [
    content.title.trim(),
    content.body.replace(/\r\n/g, '\n').trim(),
    content.state,
    [...new Set(content.labels.map((l) => l.toLowerCase()))].sort(),
  ];
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
