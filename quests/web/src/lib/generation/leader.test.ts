/**
 * Against a real Postgres, deliberately.
 *
 * The whole mechanism is one Postgres primitive - a session-scoped advisory lock - so a test
 * with a mocked client would assert that we call pg_try_advisory_lock, which is not the
 * question. The questions are whether a second contender is refused, whether releasing hands
 * over, and whether the heartbeat can tell.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { release, startLeader, stillHeld, tryAcquire } from "./leader";
import type { Leader } from "./leader";

/**
 * A key unique to this run.
 *
 * Not QUEUE_LOCK_KEY: a dev server on the same database is a real contender for that lock,
 * and a test that took it from one would stop that queue for the length of the run.
 */
let key: string;
let clients: PoolClient[] = [];

async function contender(): Promise<PoolClient> {
  const client = await db().connect();
  clients.push(client);
  return client;
}

beforeEach(() => {
  key = `test-leader-${Math.random().toString(36).slice(2, 10)}`;
});

afterEach(async () => {
  // Releasing the client returns it to the pool still holding any session lock, so the lock
  // must go first - the same finally-block discipline lock.ts describes.
  for (const client of clients) {
    await release(client, key).catch(() => {});
    client.release();
  }
  clients = [];
});

afterAll(async () => {
  await closeDb();
});

it("gives the lock to one contender and refuses the other", async () => {
  const first = await contender();
  const second = await contender();

  expect(await tryAcquire(first, key)).toBe(true);
  expect(await tryAcquire(second, key)).toBe(false);
});

it("hands over once the holder releases", async () => {
  const first = await contender();
  const second = await contender();

  await tryAcquire(first, key);
  expect(await tryAcquire(second, key)).toBe(false);

  await release(first, key);
  expect(await tryAcquire(second, key)).toBe(true);
});

it("reports the lock as held by the connection that took it", async () => {
  const client = await contender();
  await tryAcquire(client, key);

  expect(await stillHeld(client, key)).toBe(true);
});

it("reports the lock as not held after it is released", async () => {
  const client = await contender();
  await tryAcquire(client, key);
  await release(client, key);

  expect(await stillHeld(client, key)).toBe(false);
});

it("does not mistake another connection's lock for its own", async () => {
  const holder = await contender();
  const other = await contender();
  await tryAcquire(holder, key);

  expect(await stillHeld(other, key)).toBe(false);
});

describe("startLeader", () => {
  let leaders: Leader[] = [];

  afterEach(async () => {
    // stop() releases the lock before the client goes back to the pool, so every leader
    // started in a test must be stood down here or it keeps contending for `key` (or, worse,
    // keeps a client checked out) into the next test.
    await Promise.all(leaders.map((leader) => leader.stop()));
    leaders = [];
  });

  async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  it("gives leadership to exactly one of two contenders", async () => {
    const a = startLeader({ key, retryMs: 20, heartbeatMs: 50 });
    const b = startLeader({ key, retryMs: 20, heartbeatMs: 50 });
    leaders.push(a, b);

    await until(() => a.held() || b.held());

    expect([a.held(), b.held()].filter(Boolean)).toHaveLength(1);
  });

  it("releases the lock on stop so a new contender can take it", async () => {
    const leader = startLeader({ key, retryMs: 20, heartbeatMs: 50 });
    leaders.push(leader);
    await until(() => leader.held());

    await leader.stop();

    const client = await contender();
    expect(await tryAcquire(client, key)).toBe(true);
  });

  /**
   * The regression test for the race in tick()/stop(): calling stop() the instant
   * startLeader() returns lands it while the first tick is still mid-await, connecting and
   * acquiring. A stop() that only flags "stopped" and stands down whatever client exists
   * *right now* returns before that tick resolves - client is still null, so standDown() is a
   * no-op - and the orphaned tick later finishes, assigns the acquired client and flips
   * `leading` to true with nobody left to unwind it. That happens strictly after stop()'s
   * promise has already resolved, so the assertion has to wait out a real connect-and-query
   * round trip (a few ms locally; 300ms is a generous margin) before it can see the fault -
   * a fixed stop() that truly awaits the in-flight tick would never let this in the first
   * place, so held() stays false immediately and for as long as we keep checking.
   */
  it("reports held() as false once stop() has returned, even when stop lands mid-tick", async () => {
    const leader = startLeader({ key, retryMs: 1, heartbeatMs: 1 });
    leaders.push(leader);

    await leader.stop();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(leader.held()).toBe(false);
  });
});
