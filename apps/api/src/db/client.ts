import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Logger } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import * as relations from './relations.js';

type Env = Record<string, string | undefined>;

/**
 * DATABASE_URL, or one built from POSTGRES_USER / POSTGRES_PASSWORD /
 * POSTGRES_HOST / POSTGRES_PORT / POSTGRES_DB when it is unset. Each part is
 * URL-encoded, so passwords containing @ : / # and the like work.
 */
export function resolveDatabaseUrl(env: Env = process.env): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.POSTGRES_PASSWORD) return undefined;
  const user = encodeURIComponent(env.POSTGRES_USER || 'flowtask');
  const password = encodeURIComponent(env.POSTGRES_PASSWORD);
  const host = env.POSTGRES_HOST || 'localhost';
  const port = env.POSTGRES_PORT || '5432';
  const database = encodeURIComponent(env.POSTGRES_DB || 'flowtask');
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

// Create the postgres connection
export function createConnection(connectionString?: string) {
  const url = connectionString || resolveDatabaseUrl();
  if (!url) {
    throw new Error('DATABASE_URL (or POSTGRES_PASSWORD and friends) is required');
  }
  // Explicit pool limits so multiple processes don't exhaust Postgres
  // connections, plus timeouts to fail fast on hung/dead connections.
  return postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 20, // seconds before an idle connection is closed
    connect_timeout: 10, // seconds to wait for a new connection
    max_lifetime: 60 * 30, // recycle connections after 30 minutes
  });
}

// Create the drizzle database instance
export function createDatabase(connectionString?: string, options: { logger?: Logger } = {}) {
  const client = createConnection(connectionString);
  return drizzle(client, {
    schema: { ...schema, ...relations },
    ...(options.logger ? { logger: options.logger } : {}),
  });
}

// Type for the database instance
export type Database = ReturnType<typeof createDatabase>;

// Singleton instance for the main database connection
let db: Database | null = null;

export function getDatabase(): Database {
  if (!db) {
    db = createDatabase();
  }
  return db;
}

// Arbitrary constant key for the migration advisory lock.
const MIGRATION_LOCK_KEY = 7_340_001;

/**
 * Apply pending drizzle migrations from `migrationsFolder`. A session-level
 * pg_advisory_lock on a dedicated single connection makes concurrent replicas
 * wait for each other instead of racing; the waiters then find nothing to do.
 */
export async function runMigrations(
  migrationsFolder: string,
  connectionString?: string
): Promise<void> {
  const url = connectionString || resolveDatabaseUrl();
  if (!url) {
    throw new Error('DATABASE_URL (or POSTGRES_PASSWORD and friends) is required');
  }
  const client = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    await client`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    try {
      await migrate(drizzle(client), { migrationsFolder });
    } finally {
      await client`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

/** Close the shared pool, waiting up to `timeoutSeconds` for queries in flight. */
export async function closeDatabase(timeoutSeconds = 5): Promise<void> {
  if (!db) return;
  const current = db;
  db = null;
  await current.$client.end({ timeout: timeoutSeconds });
}

// For testing - allows resetting the singleton
export function resetDatabase(): void {
  db = null;
}
