/**
 * @-mention tokens in task descriptions and comments.
 *
 * Wire format (what the editor inserts and the server parses):
 *   @[Display Name](user:<uuid>)
 * The display name is informational only; the uuid is authoritative. Names
 * may not contain "]" (formatMention strips it).
 */

export interface Mention {
  userId: string;
  name: string;
  /** Index of the "@" in the source text. */
  index: number;
  /** Full token length (for highlighting/replacement). */
  length: number;
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const MENTION_PATTERN = `@\\[([^\\]\\n]{1,100})\\]\\(user:(${UUID})\\)`;

/** Parse every mention token in order of appearance (duplicates included). */
export function parseMentions(text: string | null | undefined): Mention[] {
  if (!text) return [];
  const re = new RegExp(MENTION_PATTERN, 'g');
  const mentions: Mention[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    mentions.push({
      name: match[1]!,
      userId: match[2]!.toLowerCase(),
      index: match.index,
      length: match[0].length,
    });
  }
  return mentions;
}

/** Distinct mentioned user ids, in order of first appearance. */
export function extractMentionedUserIds(text: string | null | undefined): string[] {
  return [...new Set(parseMentions(text).map((m) => m.userId))];
}

/** User ids mentioned in `next` that were not already mentioned in `previous`. */
export function newlyMentionedUserIds(
  previous: string | null | undefined,
  next: string | null | undefined
): string[] {
  const before = new Set(extractMentionedUserIds(previous));
  return extractMentionedUserIds(next).filter((id) => !before.has(id));
}

/** Build a mention token for the editor. */
export function formatMention(name: string, userId: string): string {
  const safeName =
    name
      .replace(/[\]\n]/g, '')
      .trim()
      .slice(0, 100) || 'user';
  return `@[${safeName}](user:${userId})`;
}

/** Replace mention tokens with "@Name" (for plain-text excerpts, emails, webhooks). */
export function stripMentions(text: string): string {
  return text.replace(new RegExp(MENTION_PATTERN, 'g'), (_token, name: string) => `@${name}`);
}
