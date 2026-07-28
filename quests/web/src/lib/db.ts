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
import { Pool } from "pg";

const poolKey = Symbol.for("wow-voiceover.pool");
type PoolHolder = { [poolKey]?: Pool };

export function db(): Pool {
  const holder = globalThis as PoolHolder;
  // Memoised on globalThis because the dev server re-evaluates modules on hot reload, and
  // a fresh pool per reload leaks connections until Postgres refuses new ones.
  if (!holder[poolKey]) {
    holder[poolKey] = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return holder[poolKey]!;
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
