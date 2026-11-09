/**
 * AES-256-GCM encryption for stored provider API keys.
 *
 * API_KEY_ENCRYPTION_KEY should be 32 random bytes encoded as hex (64 chars)
 * or base64 (44 chars). Older deployments used an arbitrary string that was
 * sliced/padded to 32 characters; that derivation is kept as a fallback so
 * existing ciphertexts keep decrypting, and new writes use the decoded key.
 */

export interface ApiKeyEncryptionKeys {
  /** Key used for new encryptions. */
  current: Uint8Array;
  /** Legacy pad/slice derivation, tried on decrypt when it differs from current. */
  legacy: Uint8Array;
  /** False when the configured value is not a proper 32-byte key. */
  isStrongKey: boolean;
}

const KEY_BYTES = 32;
let warnedWeakKey = false;

function legacyDerivation(raw: string): Uint8Array {
  return new TextEncoder().encode(raw.slice(0, KEY_BYTES).padEnd(KEY_BYTES, '0'));
}

function decodeHex(raw: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    return null;
  }
  const bytes = new Uint8Array(KEY_BYTES);
  for (let index = 0; index < KEY_BYTES; index += 1) {
    bytes[index] = Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function decodeBase64(raw: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/_-]{43}={0,1}$/.test(raw)) {
    return null;
  }
  try {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.length % 4 === 0 ? normalized : normalized.padEnd(normalized.length + (4 - (normalized.length % 4)), '=');
    const binary = atob(padded);
    if (binary.length !== KEY_BYTES) {
      return null;
    }
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export function deriveApiKeyEncryptionKeys(raw: string): ApiKeyEncryptionKeys {
  const trimmed = raw.trim();
  const decoded = decodeHex(trimmed) ?? decodeBase64(trimmed);
  const legacy = legacyDerivation(raw);
  return decoded ? { current: decoded, legacy, isStrongKey: true } : { current: legacy, legacy, isStrongKey: false };
}

function readConfiguredKey(): string {
  const key = process.env.API_KEY_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('API_KEY_ENCRYPTION_KEY environment variable is required');
  }
  return key;
}

/**
 * Logs once when API_KEY_ENCRYPTION_KEY is not a decodable 32-byte key.
 * Call at startup; it also runs lazily on first use.
 */
export function checkApiKeyEncryptionConfig(raw: string | undefined = process.env.API_KEY_ENCRYPTION_KEY): void {
  if (!raw || warnedWeakKey) {
    return;
  }
  if (!deriveApiKeyEncryptionKeys(raw).isStrongKey) {
    warnedWeakKey = true;
    console.warn(
      'API_KEY_ENCRYPTION_KEY is not a 32-byte key; using the legacy padded derivation. ' +
        'Generate one with `openssl rand -hex 32` (existing keys keep decrypting after the change).'
    );
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function importKey(bytes: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [usage]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export async function encryptWithKeys(plaintext: string, keys: ApiKeyEncryptionKeys): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(keys.current, 'encrypt');
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return toBase64(combined);
}

export async function decryptWithKeys(ciphertext: string, keys: ApiKeyEncryptionKeys): Promise<string> {
  const combined = Uint8Array.from(atob(ciphertext), (char) => char.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  const candidates = sameBytes(keys.current, keys.legacy) ? [keys.current] : [keys.current, keys.legacy];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const key = await importKey(candidate, 'decrypt');
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
      return new TextDecoder().decode(decrypted);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to decrypt API key');
}

export async function encryptApiKey(apiKey: string): Promise<string> {
  const raw = readConfiguredKey();
  checkApiKeyEncryptionConfig(raw);
  return encryptWithKeys(apiKey, deriveApiKeyEncryptionKeys(raw));
}

export async function decryptApiKey(ciphertext: string): Promise<string> {
  const raw = readConfiguredKey();
  checkApiKeyEncryptionConfig(raw);
  return decryptWithKeys(ciphertext, deriveApiKeyEncryptionKeys(raw));
}
