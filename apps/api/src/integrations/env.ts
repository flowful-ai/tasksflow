/**
 * Environment helpers for integration credentials.
 */

/**
 * Normalize a secret read from the environment: trims whitespace and strips
 * stray wrapping quotes or backticks (a compose typo once appended a backtick
 * to SLACK_APP_TOKEN). Returns undefined for empty values.
 */
export function normalizeSecret(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = value
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Read and normalize a secret/credential environment variable. */
export function readSecretEnv(name: string): string | undefined {
  return normalizeSecret(process.env[name]);
}

/** Public web URL used for links back into FlowTask. */
export function getWebUrl(): string {
  return (readSecretEnv('WEB_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
}
