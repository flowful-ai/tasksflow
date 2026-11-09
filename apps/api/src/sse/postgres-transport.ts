import postgres from 'postgres';
import type { RealtimeTransport } from './hub.js';
import { NOTIFY_CHANNEL } from './wire.js';

/** Sends one NOTIFY. In production this is the application pool (`db.$client.notify`). */
export type NotifyPublisher = (channel: string, payload: string) => Promise<void>;

/** application_name of the LISTEN connection (visible in pg_stat_activity). */
export const LISTEN_APPLICATION_NAME = 'flowtask-realtime-listen';

/**
 * LISTEN/NOTIFY transport.
 *
 * Exactly one extra connection per instance: the LISTEN. postgres.js runs
 * `listen` on a dedicated connection of its own; the client created here is
 * never queried, so its pool (capped at 1 anyway) stays empty. NOTIFY goes
 * through `publish`, i.e. the application's existing pool, so it costs no
 * connection of its own. A fresh client is created per subscription so a
 * reconnect after a lost connection starts from a clean state.
 */
export class PostgresTransport implements RealtimeTransport {
  private sql: postgres.Sql | null = null;

  constructor(
    private readonly connectionString: string,
    private readonly notify: NotifyPublisher
  ) {}

  async subscribe(onMessage: (payload: string) => void): Promise<void> {
    const sql = postgres(this.connectionString, {
      max: 1,
      connect_timeout: 10,
      connection: { application_name: LISTEN_APPLICATION_NAME },
    });
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
    await this.notify(NOTIFY_CHANNEL, payload);
  }

  async close(): Promise<void> {
    const sql = this.sql;
    this.sql = null;
    if (sql) await sql.end({ timeout: 2 });
  }
}
