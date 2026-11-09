import type { Database } from '../../db/index.js';

/** A drizzle transaction handle for the app database. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Anything that can run queries: the database or an open transaction. */
export type DbExecutor = Database | Tx;
