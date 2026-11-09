import { createConnection } from '@flowtask/database';
import type { RealtimeTransport } from './hub.js';
import { NOTIFY_CHANNEL } from './wire.js';

type Sql = ReturnType<typeof createConnection>;

/**
 * LISTEN/NOTIFY transport on its own postgres.js client, separate from the
 * application pool (postgres.js additionally runs `listen` on a dedicated
 * connection of that client). A fresh client is created per subscription so
 * a reconnect after a lost connection starts from a clean state.
 */
export class PostgresTransport implements RealtimeTransport {
  private sql: Sql | null = null;

  constructor(private readonly connectionString: string) {}

  async subscribe(onMessage: (payload: string) => void): Promise<void> {
    const sql = createConnection(this.connectionString);
    this.sql = sql;
    await sql.listen(NOTIFY_CHANNEL, (payload) => {
      try {
        onMessage(payload);
      } catch (error) {
        console.error('[realtime] message handler failed:', error);
      }
    });
  }

  async publish(payload: string): Promise<void> {
    if (!this.sql) throw new Error('Realtime transport is not connected');
    await this.sql.notify(NOTIFY_CHANNEL, payload);
  }

  async close(): Promise<void> {
    const sql = this.sql;
    this.sql = null;
    if (sql) await sql.end({ timeout: 2 });
  }
}
