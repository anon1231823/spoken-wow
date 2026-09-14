/**
 * Against a real Postgres: an advisory lock that only works in one process is not a lock.
 * See history.test.ts for the setup this needs.
 */
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { BUSY, LOCK_NAMESPACE, withFileLock } from "./lock";

const FILE = "gossip/lock-test.mp3";

afterAll(async () => {
  await closeDb();
});

/** Whether anything currently holds this file's lock, asked from outside the pool's view. */
async function heldLocks(key: string): Promise<number> {
  const { rows } = await db().query<{ count: string }>(
    `select count(*)::text as count from pg_locks
      where locktype = 'advisory' and classid = $1
        and objid = (select hashtext($2)::int8 & x'FFFFFFFF'::int8)::int4`,
    [LOCK_NAMESPACE, key],
  );
  return Number(rows[0].count);
}

describe("withFileLock", () => {
  it("runs the work and returns its result", async () => {
    expect(await withFileLock(FILE, async () => "done")).toBe("done");
  });

  it("refuses a second holder rather than queueing behind the first", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withFileLock(FILE, async () => {
      // While this is held, a second attempt must come back immediately.
      expect(await withFileLock(FILE, async () => "should not run")).toBe(BUSY);
      release();
      return "first";
    });

    await blocked;
    expect(await first).toBe("first");
  });

  it("does not block a different file", async () => {
    // A name of this test's own, not a real corpus file: regenerate.test.ts takes the lock on
    // quests/5-accept.mp3, test files run in parallel against one database, and "a different
    // file is free" is not a claim to make about a file another test is holding.
    const result = await withFileLock(FILE, () =>
      withFileLock("gossip/lock-test-other.mp3", async () => "other file"),
    );
    expect(result).toBe("other file");
  });

  // The lock is session-scoped, so it outlives the query that took it. A client returned to
  // the pool still holding one would block that file until the process restarts - which is
  // the failure this asserts against, and the reason for the finally block.
  it("releases the lock when the work succeeds", async () => {
    // Asserting the lock is visible *while* held first, so the release assertion below
    // cannot pass merely because heldLocks never finds anything.
    await withFileLock(FILE, async () => {
      expect(await heldLocks(FILE)).toBe(1);
    });
    expect(await heldLocks(FILE)).toBe(0);
  });

  it("releases the lock when the work throws", async () => {
    await expect(
      withFileLock(FILE, async () => {
        throw new Error("ElevenLabs said no");
      }),
    ).rejects.toThrow("ElevenLabs said no");

    expect(await heldLocks(FILE)).toBe(0);
    // And the file is immediately usable again, which is what the operator will try next.
    expect(await withFileLock(FILE, async () => "retried")).toBe("retried");
  });
});
