/**
 * The one Postgres pool.
 *
 * Shared rather than one per module: pm2 runs two workers, so every additional pool is
 * another set of idle connections against a database that only holds accounts, roles and
 * voice provenance.
 *
 * `new Pool()` does not open a connection until the first query, so importing this during
 * `next build` does not need a reachable database.
 */
import { Pool, type QueryResultRow } from "pg";

/**
 * How many connections one process may hold.
 *
 * Sized rather than left at node-postgres' default of 10, because the regeneration queue
 * holds two clients per job in flight - the per-file advisory lock in lock.ts across the
 * whole ElevenLabs call, and a second one for commitTake's transaction inside it -
 * plus one the leader never returns. At the default, a batch wide enough fills the pool with
 * its own held clients and then waits forever for the commits that would free them.
 *
 * Thirty against a Postgres with max_connections = 100 and two pm2 cluster workers: sixty in
 * the worst case where both workers are saturated, leaving room for psql, a migration and the
 * odd one-off process. Raising this without also re-reading max_connections is how a deploy
 * starts failing on "too many clients".
 */
export const POOL_MAX = 30;

/**
 * How long a query waits for a free connection before giving up.
 *
 * node-postgres waits forever by default, which turns pool exhaustion into a process that
 * accepts requests and answers none of them - including the one that would stop the queue.
 * Ten seconds is longer than any statement this app runs, so reaching it means the pool is
 * exhausted, and an error that names that is worth far more than a hang.
 */
export const POOL_CONNECTION_TIMEOUT_MS = 10_000;

const poolKey = Symbol.for("wow-voiceover.pool");
type PoolHolder = { [poolKey]?: Pool };

export function db(): Pool {
  const holder = globalThis as PoolHolder;
  // Memoised on globalThis because the dev server re-evaluates modules on hot reload, and
  // a fresh pool per reload leaks connections until Postgres refuses new ones.
  if (!holder[poolKey]) {
    holder[poolKey] = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: POOL_MAX,
      connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    });
  }
  return holder[poolKey]!;
}

/**
 * One query, rows only.
 *
 * Most of this app reaches for db().query directly, because it wants the result object -
 * rowCount is what several statements are checked by. This is for the modules where the
 * rows are the whole answer, and it exists so code moved here from the zones app keeps
 * reading the way it did rather than growing a `.rows` at every call site.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await db().query<T>(text, params);
  return result.rows;
}

/**
 * Close the pool and forget it, so the next db() builds a fresh one.
 *
 * For tests. Ending the pool without clearing the memo leaves a closed pool on globalThis,
 * and vitest reuses workers between files - so one test file finishing would break the next
 * one to run in that worker, as an intermittent "Cannot use a pool after calling end".
 */
export async function closeDb(): Promise<void> {
  const holder = globalThis as PoolHolder;
  const pool = holder[poolKey];
  if (!pool) return;
  delete holder[poolKey];
  await pool.end();
}
