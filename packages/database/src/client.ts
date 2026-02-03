import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import * as relations from './relations.js';

// Create the postgres connection
export function createConnection(connectionString?: string) {
  const url = connectionString || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  return postgres(url);
}

// Create the drizzle database instance
export function createDatabase(connectionString?: string) {
  const client = createConnection(connectionString);
  return drizzle(client, {
    schema: { ...schema, ...relations },
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

// For testing - allows resetting the singleton
export function resetDatabase(): void {
  db = null;
}
