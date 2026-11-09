import { describe, expect, test } from 'bun:test';
import { formatMention } from '@flowtask/shared/utils';
import { activeMentionQuery, decodeMentions, encodeMentions } from './mentionText';
import { mentionsToMarkdown } from './Markdown';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('mention text', () => {
  test('encode replaces display names with tokens, longest first', () => {
    const text = '@Jo Doe and @Jo, ping @Jo';
    const out = encodeMentions(text, [
      { userId: A, name: 'Jo' },
      { userId: B, name: 'Jo Doe' },
    ]);
    expect(out).toBe(`${formatMention('Jo Doe', B)} and ${formatMention('Jo', A)}, ping ${formatMention('Jo', A)}`);
  });

  test('encode ignores names that are only a prefix of a word', () => {
    expect(encodeMentions('@Jonas', [{ userId: A, name: 'Jo' }])).toBe('@Jonas');
  });

  test('decode round-trips', () => {
    const stored = `hi ${formatMention('Nico', A)}!`;
    const decoded = decodeMentions(stored);
    expect(decoded.text).toBe('hi @Nico!');
    expect(encodeMentions(decoded.text, decoded.mentions)).toBe(stored);
  });

  test('active query before the caret', () => {
    expect(activeMentionQuery('hello @ni', 9)).toEqual({ query: 'ni', start: 6 });
    expect(activeMentionQuery('@', 1)).toEqual({ query: '', start: 0 });
    expect(activeMentionQuery('mail@x', 6)).toBeNull();
    expect(activeMentionQuery('@ni hello', 9)).toBeNull();
  });

  test('markdown rewrite turns tokens into fragment links', () => {
    expect(mentionsToMarkdown(`ok ${formatMention('Jo', A)}`)).toBe(`ok [@Jo](#mention-${A})`);
  });
});
