import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { readSecretEnv } from './env.js';

/**
 * Constant-time string comparison that tolerates differing lengths.
 * crypto.timingSafeEqual throws a RangeError when the buffers differ in
 * length, so the length is checked first (the early return only reveals the
 * length of an attacker-controlled value).
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** URL-safe random token, e.g. for OAuth `state` nonces. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

const SECRET_PREFIX = 'v1';

function getEncryptionKey(): Buffer {
  const raw = readSecretEnv('INTEGRATION_ENCRYPTION_KEY') ?? readSecretEnv('API_KEY_ENCRYPTION_KEY');
  if (!raw) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY (or API_KEY_ENCRYPTION_KEY) is required to store integration tokens');
  }
  // Derive a 256-bit key from whatever format the operator supplied.
  return createHash('sha256').update(raw).digest();
}

/** Encrypt a secret (e.g. a Slack bot token) with AES-256-GCM. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SECRET_PREFIX, iv.toString('base64'), Buffer.concat([tag, ciphertext]).toString('base64')].join(':');
}

export function decryptSecret(encoded: string): string {
  const [prefix, ivB64, payloadB64] = encoded.split(':');
  if (prefix !== SECRET_PREFIX || !ivB64 || !payloadB64) {
    throw new Error('Unsupported encrypted secret format');
  }
  const payload = Buffer.from(payloadB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(payload.subarray(0, 16));
  return Buffer.concat([decipher.update(payload.subarray(16)), decipher.final()]).toString('utf8');
}
