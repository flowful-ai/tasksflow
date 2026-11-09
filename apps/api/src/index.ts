import { closeDatabase, getDatabase, runMigrations } from './db/index.js';
import { createApp } from './app.js';
import { startApiBackground } from './background/index.js';
import { applyClientIp, parseTrustedProxyHops, resolveClientIp } from './lib/client-ip.js';
import { resolveMigrationsDir, shouldRunMigrations } from './lib/migrations.js';
import {
  markShuttingDown,
  registerShutdownHook,
  runShutdownHooks,
  withTimeout,
} from './lib/shutdown.js';
import { initSSE, shutdownSSE } from './sse/manager.js';
import { checkApiKeyEncryptionConfig, rekeyTaskPositions } from './domain/index.js';

const { app, webDistDir } = createApp();

// Start server with Bun
const port = parseInt(process.env.API_PORT || '3001', 10);
const hostname = process.env.API_HOST || '0.0.0.0';
const trustedProxyHops = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);
const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000);

async function applyMigrations(): Promise<void> {
  if (!shouldRunMigrations(process.env.RUN_MIGRATIONS)) return;
  const dir = resolveMigrationsDir();
  if (!dir) {
    throw new Error('Migrations folder not found: set MIGRATIONS_DIR, or RUN_MIGRATIONS=false');
  }
  console.log(`Applying database migrations from ${dir}`);
  await runMigrations(dir);
}

/**
 * Repair task position keys written by the pre-v2 generator. A read-only scan
 * when every column is healthy; runs in the background so boot isn't delayed.
 */
function repairTaskPositions(): void {
  rekeyTaskPositions(getDatabase(), { onlyInvalid: true })
    .then((report) => {
      if (report.columnsRekeyed > 0) {
        console.log(
          `Re-keyed ${report.columnsRekeyed} task column(s), ${report.tasksUpdated} task(s) updated`
        );
      }
    })
    .catch((error: Error) => console.error('Task position repair failed:', error.message));
}

function startServer(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname,
    port,
    fetch(req, server) {
      // Resolve the client IP once, from the proxy chain we trust, and overwrite
      // the forwarded headers so nothing downstream reads a spoofed value.
      const socketIp = server.requestIP(req)?.address ?? null;
      applyClientIp(
        req.headers,
        resolveClientIp(req.headers.get('x-forwarded-for'), socketIp, trustedProxyHops)
      );
      return app.fetch(req, server);
    },
    // Increase idle timeout for SSE connections (default is 10s which kills long-lived streams)
    idleTimeout: 255, // Maximum allowed value in Bun (in seconds)
  });
}

function installShutdownHandlers(server: ReturnType<typeof Bun.serve>): void {
  let started = false;
  const shutdown = async (signal: string) => {
    if (started) return;
    started = true;
    markShuttingDown();
    console.log(`${signal} received: draining`);
    // Stop accepting new connections; resolves once open ones have finished.
    const drained = server.stop();
    // SSE streams and background jobs end through their hooks.
    await runShutdownHooks(shutdownTimeoutMs);
    await withTimeout(drained, shutdownTimeoutMs, 'in-flight requests');
    await server.stop(true);
    await closeDatabase().catch((error: Error) => {
      console.error('Closing the database pool failed:', error.message);
    });
    console.log('Shutdown complete');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (import.meta.main) {
  // Warns once when API_KEY_ENCRYPTION_KEY isn't a 32-byte key (legacy derivation).
  checkApiKeyEncryptionConfig();
  try {
    await applyMigrations();
  } catch (error) {
    console.error('Database migration failed:', error);
    process.exit(1);
  }
  repairTaskPositions();
  const server = startServer();
  installShutdownHandlers(server);
  console.log(
    `FlowTask API running at http://${hostname}:${server.port}` +
      (webDistDir ? ` (serving SPA from ${webDistDir})` : ' (no SPA build found)')
  );
  // Initialize SSE manager (same port as API); streams close on shutdown.
  initSSE();
  registerShutdownHook(() => shutdownSSE());
  // Domain-event bridges, subscribers and the Postgres job runner, stopped on shutdown.
  const background = startApiBackground(getDatabase());
  registerShutdownHook(() => background.stop());
}

// No default export: Bun would treat a default export with `fetch` as a
// server config and start a second listener on port 3000.
export { app };
