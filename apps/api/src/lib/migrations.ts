import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Drizzle migrations folder: MIGRATIONS_DIR, else apps/api/drizzle in
 * the repo (dev), else ./drizzle next to the bundle (Docker image). Null when
 * none has a meta/_journal.json.
 */
export function resolveMigrationsDir(
  env: Record<string, string | undefined> = process.env
): string | null {
  const candidates = [
    env.MIGRATIONS_DIR,
    join(import.meta.dir, '../../drizzle'),
    join(import.meta.dir, 'drizzle'),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, 'meta', '_journal.json')))
      return resolve(candidate);
  }
  return null;
}

/** RUN_MIGRATIONS defaults to true; only "false" or "0" turn it off. */
export function shouldRunMigrations(value: string | undefined): boolean {
  return !(value === 'false' || value === '0');
}
