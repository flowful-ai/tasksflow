import { describe, expect, it } from 'bun:test';
import { decryptWithKeys, deriveApiKeyEncryptionKeys, encryptWithKeys } from './encryption.js';

const HEX_KEY = 'a1'.repeat(32);
const BASE64_KEY = Buffer.alloc(32, 7).toString('base64');

describe('deriveApiKeyEncryptionKeys', () => {
  it('decodes a 64-char hex key into 32 bytes', () => {
    const keys = deriveApiKeyEncryptionKeys(HEX_KEY);
    expect(keys.isStrongKey).toBe(true);
    expect(keys.current.length).toBe(32);
    expect(keys.current[0]).toBe(0xa1);
  });

  it('decodes a base64 key into 32 bytes', () => {
    const keys = deriveApiKeyEncryptionKeys(BASE64_KEY);
    expect(keys.isStrongKey).toBe(true);
    expect(Array.from(keys.current)).toEqual(new Array(32).fill(7));
  });

  it('falls back to the legacy pad/slice derivation for other strings', () => {
    const keys = deriveApiKeyEncryptionKeys('dev-secret');
    expect(keys.isStrongKey).toBe(false);
    expect(new TextDecoder().decode(keys.current)).toBe('dev-secret'.padEnd(32, '0'));
    expect(keys.current).toEqual(keys.legacy);
  });
});

describe('API key encryption back-compat', () => {
  it('round-trips with a strong key', async () => {
    const keys = deriveApiKeyEncryptionKeys(HEX_KEY);
    const ciphertext = await encryptWithKeys('sk-or-123', keys);
    expect(await decryptWithKeys(ciphertext, keys)).toBe('sk-or-123');
  });

  it('decrypts values written with the legacy derivation of the same configured key', async () => {
    // Before this change the hex string itself was sliced to 32 chars.
    const legacyOnly = deriveApiKeyEncryptionKeys('legacy-placeholder');
    const strong = deriveApiKeyEncryptionKeys(HEX_KEY);
    const legacyKeysForHex = { current: strong.legacy, legacy: strong.legacy, isStrongKey: false };

    const legacyCiphertext = await encryptWithKeys('sk-old', legacyKeysForHex);
    expect(await decryptWithKeys(legacyCiphertext, strong)).toBe('sk-old');

    // Sanity: an unrelated key cannot decrypt it.
    await expect(decryptWithKeys(legacyCiphertext, legacyOnly)).rejects.toBeDefined();
  });

  it('writes new values with the decoded key, not the legacy one', async () => {
    const strong = deriveApiKeyEncryptionKeys(HEX_KEY);
    const ciphertext = await encryptWithKeys('sk-new', strong);
    const legacyOnly = { current: strong.legacy, legacy: strong.legacy, isStrongKey: false };
    await expect(decryptWithKeys(ciphertext, legacyOnly)).rejects.toBeDefined();
  });
});
