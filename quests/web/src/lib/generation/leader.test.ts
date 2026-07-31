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

import { release, stillHeld, tryAcquire } from "./leader";

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
