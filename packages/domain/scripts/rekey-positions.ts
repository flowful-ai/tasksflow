/**
 * Re-key every task column with fresh fractional-indexing keys, preserving
 * the current order. The API already repairs invalid columns on boot; use this
 * for a manual run or a dry run.
 *
 * Usage:
 *   DATABASE_URL=postgres://… bun packages/domain/scripts/rekey-positions.ts [--dry-run] [--only-invalid]
 */
import { closeDatabase, getDatabase } from '@flowtask/database';
import { rekeyTaskPositions } from '../src/task/rekey.js';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

try {
  const report = await rekeyTaskPositions(getDatabase(), { dryRun, onlyInvalid: args.has('--only-invalid') });
  console.log(
    `${dryRun ? '[dry-run] ' : ''}columns scanned: ${report.columnsScanned}, re-keyed: ${report.columnsRekeyed}, tasks updated: ${report.tasksUpdated}`
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
