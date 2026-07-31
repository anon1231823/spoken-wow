/**
 * Which process drains the queue.
 *
 * pm2 runs two cluster workers and a deploy replaces them one at a time, so without an
 * answer to this every restart would double the number of processes pulling jobs and the
 * concurrency budget would mean nothing.
 *
 * A session-scoped Postgres advisory lock, in the same namespace as the per-file locks in
 * lock.ts so there is one place in this codebase where advisory keys are accounted for. The
 * property that matters is that Postgres releases it when the connection goes away: a
 * process that crashes, is OOM-killed or has its cable pulled stops being the leader without
 * anything having to notice, which is exactly what a lease row in a table cannot promise.
 *
 * The lock is held on a client checked out of the pool and deliberately never returned. A
 * client handed back while still holding a session lock would take that lock with it into
 * the pool and block the queue until the process restarted - the failure lock.ts guards
 * against with its finally block, and the reason stop() unlocks before releasing.
 */
import type { PoolClient } from "pg";

import { db } from "@/lib/db";

import { LOCK_NAMESPACE } from "./lock";

export const QUEUE_LOCK_KEY = "regeneration-queue";

export async function tryAcquire(client: PoolClient, key: string): Promise<boolean> {
  const { rows } = await client.query<{ locked: boolean }>(
    "select pg_try_advisory_lock($1, hashtext($2)) as locked",
    [LOCK_NAMESPACE, key],
  );
  return rows[0]?.locked === true;
}

/**
 * Is this connection still the holder?
 *
 * A network drop or a pg_terminate_backend releases the lock while this process still
 * believes it leads, which is how two leaders happen. Asking pg_locks directly - restricted
 * to this backend's own pid - is the only answer that cannot be stale, and the query doubles
 * as the keepalive that stops an idle connection being reaped in the first place.
 *
 * hashtext returns a signed integer and pg_locks.objid is an oid, so the comparison needs an
 * explicit cast. Getting that wrong returns "not mine" forever and the queue silently stops,
 * which is why leader.test.ts asserts the true case rather than only the false one.
 */
export async function stillHeld(client: PoolClient, key: string): Promise<boolean> {
  const { rows } = await client.query<{ held: boolean }>(
    `select exists (
       select 1 from pg_locks
        where locktype = 'advisory'
          and classid = $1::int
          and objid = hashtext($2)::oid
          and pid = pg_backend_pid()
          and granted
     ) as held`,
    [LOCK_NAMESPACE, key],
  );
  return rows[0]?.held === true;
}

export async function release(client: PoolClient, key: string): Promise<void> {
  await client.query("select pg_advisory_unlock($1, hashtext($2))", [LOCK_NAMESPACE, key]);
}

export type Leader = {
  /** Whether this process currently leads. Read by the worker before every claim. */
  held(): boolean;
  /** Stand down: release the lock, hand the client back, stop contending. */
  stop(): Promise<void>;
};

/**
 * Contend for leadership until stopped.
 *
 * One timer doing two jobs: while not leading it retries the acquire, and while leading it
 * heartbeats. Failing either one stands the process down rather than assuming the best -
 * a leader that has quietly lost its lock is worse than no leader, because the next one is
 * already draining.
 */
export function startLeader(
  options: { key?: string; retryMs?: number; heartbeatMs?: number } = {},
): Leader {
  const key = options.key ?? QUEUE_LOCK_KEY;
  const retryMs = options.retryMs ?? 5_000;
  const heartbeatMs = options.heartbeatMs ?? 10_000;

  let client: PoolClient | null = null;
  let leading = false;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function standDown(): Promise<void> {
    leading = false;
    if (!client) return;
    const held = client;
    client = null;
    await release(held, key).catch(() => {});
    held.release();
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      if (leading) {
        if (!(await stillHeld(client!, key))) await standDown();
      } else {
        if (!client) client = await db().connect();
        leading = await tryAcquire(client, key);
        // Holding an idle connection out of the pool to lose the race every five seconds is
        // a waste of one of ten slots, so a loser gives its client back.
        if (!leading) await standDown();
      }
    } catch {
      // A broken connection is not a reason to crash the app: stand down, and the next tick
      // starts contending again with a fresh client.
      await standDown().catch(() => {});
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), leading ? heartbeatMs : retryMs);
    }
  }

  void tick();

  return {
    held: () => leading,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await standDown();
    },
  };
}
