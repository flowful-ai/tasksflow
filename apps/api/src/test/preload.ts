/**
 * bun test preload (see bunfig.toml). With TEST_DATABASE_URL set, apply the
 * production migrations once before any suite runs, so integration tests
 * never depend on which file happens to migrate first on a fresh database.
 * Without it this is a no-op and DB suites skip themselves.
 */
import { join } from 'node:path';

const url = process.env.TEST_DATABASE_URL;
if (url) {
  const { runMigrations } = await import('../db/index.js');
  await runMigrations(join(import.meta.dir, '..', '..', 'drizzle'), url);
}
