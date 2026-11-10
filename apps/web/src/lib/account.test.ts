import { describe, expect, test } from 'bun:test';
import {
  avatarUrlOf,
  canEditWorkspace,
  canLeaveWorkspace,
  describeUserAgent,
  initials,
  nextWorkspaceId,
  validateName,
} from './account';

describe('initials', () => {
  test('first and last word of the name', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('  jean   paul  sartre ')).toBe('JS');
    expect(initials('Nico')).toBe('N');
  });
  test('falls back to the email, then "?"', () => {
    expect(initials(null, 'zoe@example.com')).toBe('Z');
    expect(initials('   ', 'bob@example.com')).toBe('B');
    expect(initials(undefined, undefined)).toBe('?');
  });
  test('splits a dotted mailbox into two letters', () => {
    expect(initials(null, 'john.doe@acme.com')).toBe('JD');
    expect(initials(null, 'mary_ann-lee@acme.com')).toBe('MA');
  });
});

describe('avatarUrlOf', () => {
  test('prefers Better Auth image, then avatarUrl', () => {
    expect(avatarUrlOf({ image: 'https://a/1.png', avatarUrl: 'https://a/2.png' })).toBe(
      'https://a/1.png'
    );
    expect(avatarUrlOf({ image: null, avatarUrl: 'https://a/2.png' })).toBe('https://a/2.png');
    expect(avatarUrlOf({ image: '' })).toBeNull();
    expect(avatarUrlOf(null)).toBeNull();
  });
});

describe('validateName', () => {
  test('trims and checks bounds', () => {
    expect(validateName('  Acme  ')).toEqual({ ok: true, value: 'Acme' });
    expect(validateName('   ', 'Workspace name')).toEqual({
      ok: false,
      error: 'Workspace name is required',
    });
    expect(validateName('x'.repeat(101))).toEqual({
      ok: false,
      error: 'Name must be at most 100 characters',
    });
    expect(validateName('x'.repeat(100)).ok).toBe(true);
  });
});

describe('describeUserAgent', () => {
  test('browser and system', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      )
    ).toBe('Chrome on macOS');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      )
    ).toBe('Safari on iOS');
    expect(
      describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0')
    ).toBe('Firefox on Linux');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
      )
    ).toBe('Edge on Windows');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'
      )
    ).toBe('Chrome on Android');
  });
  test('non-browser clients and missing values', () => {
    expect(describeUserAgent('curl/8.5.0')).toBe('curl');
    expect(describeUserAgent(null)).toBe('Unknown device');
    expect(describeUserAgent('  ')).toBe('Unknown device');
  });
});

describe('workspace permissions', () => {
  test('owners and admins edit, members read', () => {
    expect(canEditWorkspace('owner')).toBe(true);
    expect(canEditWorkspace('admin')).toBe(true);
    expect(canEditWorkspace('member')).toBe(false);
    expect(canEditWorkspace(undefined)).toBe(false);
  });
  test('the last owner cannot leave', () => {
    const one = [{ role: 'owner' as const }, { role: 'member' as const }];
    const two = [...one, { role: 'owner' as const }];
    expect(canLeaveWorkspace('member', one)).toBe(true);
    expect(canLeaveWorkspace('admin', one)).toBe(true);
    expect(canLeaveWorkspace('owner', one)).toBe(false);
    expect(canLeaveWorkspace('owner', two)).toBe(true);
    expect(canLeaveWorkspace(null, two)).toBe(false);
  });
  test('next workspace after leaving', () => {
    expect(nextWorkspaceId([{ id: 'a' }, { id: 'b' }], 'a')).toBe('b');
    expect(nextWorkspaceId([{ id: 'a' }], 'a')).toBeNull();
    expect(nextWorkspaceId([], 'a')).toBeNull();
  });
});
