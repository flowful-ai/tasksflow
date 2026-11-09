import { describe, expect, it } from 'bun:test';
import { extractMentionedUserIds, formatMention, newlyMentionedUserIds, parseMentions, stripMentions } from './mentions.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('mentions', () => {
  it('parses tokens with positions', () => {
    const text = `Hi @[Jo D.](user:${A}), see @[Nico](user:${B.toUpperCase()})`;
    const mentions = parseMentions(text);
    expect(mentions.map((m) => [m.name, m.userId])).toEqual([
      ['Jo D.', A],
      ['Nico', B],
    ]);
    expect(text.slice(mentions[0]!.index, mentions[0]!.index + mentions[0]!.length)).toBe(`@[Jo D.](user:${A})`);
  });

  it('ignores malformed tokens', () => {
    expect(parseMentions('@[x](user:not-a-uuid) @Jo [y](user:' + A + ')')).toEqual([]);
    expect(parseMentions(null)).toEqual([]);
  });

  it('dedupes and diffs', () => {
    const one = formatMention('Jo', A);
    expect(extractMentionedUserIds(`${one} ${one}`)).toEqual([A]);
    expect(newlyMentionedUserIds(one, `${one} ${formatMention('Nico', B)}`)).toEqual([B]);
  });

  it('formats and strips', () => {
    expect(formatMention('Evil] name', A)).toBe(`@[Evil name](user:${A})`);
    expect(stripMentions(`ping ${formatMention('Jo', A)}!`)).toBe('ping @Jo!');
  });
});
