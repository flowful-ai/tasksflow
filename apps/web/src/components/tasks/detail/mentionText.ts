/**
 * The composer shows mentions as plain "@Name" and keeps the user ids aside;
 * these convert between that and the stored `@[Name](user:<uuid>)` tokens.
 */
import { formatMention, parseMentions } from '@flowtask/shared';

export interface DraftMention {
  userId: string;
  name: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "@Jo hi" + [{Jo}] → "@[Jo](user:…) hi". Longer names first so "@Jo Doe" wins over "@Jo". */
export function encodeMentions(text: string, mentions: DraftMention[]): string {
  const unique = [...new Map(mentions.map((m) => [m.userId, m])).values()].sort((a, b) => b.name.length - a.name.length);
  // Two passes through placeholders so a replaced token is never matched again.
  const placeholders: string[] = [];
  let out = text;
  for (const mention of unique) {
    const re = new RegExp(`@${escapeRegExp(mention.name)}(?![\\w-])`, 'g');
    out = out.replace(re, () => {
      placeholders.push(formatMention(mention.name, mention.userId));
      return `\u0000${placeholders.length - 1}\u0000`;
    });
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => placeholders[Number(index)] ?? '');
}

/** Stored text → composer text and the mentions it contains. */
export function decodeMentions(text: string): { text: string; mentions: DraftMention[] } {
  const found = parseMentions(text);
  let out = '';
  let cursor = 0;
  for (const m of found) {
    out += `${text.slice(cursor, m.index)}@${m.name}`;
    cursor = m.index + m.length;
  }
  out += text.slice(cursor);
  return { text: out, mentions: found.map((m) => ({ userId: m.userId, name: m.name })) };
}

/** The "@query" being typed right before the caret, if any. */
export function activeMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,30})$/.exec(before);
  if (!match) return null;
  return { query: match[2] ?? '', start: before.length - (match[2]?.length ?? 0) - 1 };
}
