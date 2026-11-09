/**
 * Process-wide shutdown hooks. Subsystems with long-lived work (SSE streams,
 * the job runner, LISTEN connections) register a hook; on SIGTERM/SIGINT the
 * server stops accepting requests, runs every hook concurrently, waits for
 * in-flight requests, then closes the database pool.
 */
export type ShutdownHook = () => void | Promise<void>;

const hooks = new Set<ShutdownHook>();
let shuttingDown = false;

/** Register a hook; returns a function that unregisters it. */
export function registerShutdownHook(hook: ShutdownHook): () => void {
  hooks.add(hook);
  return () => {
    hooks.delete(hook);
  };
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function markShuttingDown(): void {
  shuttingDown = true;
}

/** Run all hooks; a hook that throws or exceeds `timeoutMs` is logged and skipped. */
export async function runShutdownHooks(timeoutMs: number): Promise<void> {
  const pending = [...hooks].map(async (hook) => {
    try {
      await hook();
    } catch (error) {
      console.error('Shutdown hook failed:', error);
    }
  });
  await withTimeout(Promise.all(pending), timeoutMs, 'shutdown hooks');
}

/** Resolve when `promise` settles or after `timeoutMs`, whichever comes first. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`Timed out after ${timeoutMs}ms waiting for ${label}`);
      resolve();
    }, timeoutMs);
  });
  try {
    await Promise.race([promise.then(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
