import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { randomToken } from '../../integrations/crypto.js';

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomClientId(): string {
  return `ft_mcp_client_${randomToken(24)}`;
}

export function buildS256CodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

function graceKey(secret: string): Buffer {
  return createHash('sha256').update(`mcp-refresh-grace:${secret}`).digest();
}

/**
 * Encrypts `plaintext` with a key derived from `secret` (the presented refresh
 * token). Only a caller holding that refresh token can read it back, so the
 * payload can sit in the database without exposing the successor tokens.
 */
export function sealWithSecret(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', graceKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

export function openWithSecret(secret: string, sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', graceKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
