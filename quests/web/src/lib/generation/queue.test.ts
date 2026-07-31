/**
 * Against a real Postgres, deliberately.
 *
 * What queue.ts is for is a set of exclusions - one job per file at a time, one claimant per
 * job, a lease that expires - and every one of them lives in the schema rather than in the
 * code. A mocked database would assert that the code calls the functions the code calls,
 * which is not a test of any of that.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import type { BatchLine } from "@/lib/search";

import {
  cancelPending,
  claimNext,
  createBatch,
  enqueue,
  failJob,
  finishJob,
  retryJob,
  snapshot,
} from "./queue";

/** A file prefix no other run collides with, so tests share one database safely. */
let prefix: string;
const batches: string[] = [];

function line(n: number): BatchLine {
  return {
    lineId: `q:${n}:accept`,
    audioPath: `${prefix}/${n}.mp3`,
    npcName: `NPC ${n}`,
    voice: "human-male",
    characters: 100,
    preview: `line ${n}`,
  };
}

async function newBatch(): Promise<string> {
  const id = await createBatch("test batch", null as unknown as string);
  batches.push(id);
  return id;
}

beforeEach(() => {
  prefix = `test-${Math.random().toString(36).slice(2, 10)}`;
});

afterEach(async () => {
  // Cascades to the jobs, so nothing this file wrote outlives it.
  if (batches.length) {
    await db().query(`delete from "regeneration_batch" where "id" = any($1::uuid[])`, [batches]);
    batches.length = 0;
  }
});

afterAll(async () => {
  await closeDb();
});

describe("enqueue", () => {
  it("refuses a second job for a file already queued", async () => {
    const first = await newBatch();
    expect(await enqueue(first, [line(1), line(2)])).toEqual({ queued: 2, skipped: 0 });

    const second = await newBatch();
    expect(await enqueue(second, [line(2), line(3)])).toEqual({ queued: 1, skipped: 1 });
  });

  it("accepts a file again once its job has finished", async () => {
    const first = await newBatch();
    await enqueue(first, [line(1)]);
    const claimed = await claimNext();
    await finishJob(claimed!.id, { version: 1, credits: 55 });

    const second = await newBatch();
    expect(await enqueue(second, [line(1)])).toEqual({ queued: 1, skipped: 0 });
  });
});

describe("claimNext", () => {
  it("hands two concurrent callers different jobs", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1), line(2)]);

    const [a, b] = await Promise.all([claimNext(), claimNext()]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).not.toEqual(b!.id);
  });

  it("returns null when nothing is due", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)]);
    await claimNext();

    // The one job is now running and its lease is live, so there is nothing to claim.
    expect(await claimJobOfThisRun()).toBeNull();
  });

  it("reclaims a job whose lease has expired", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)]);
    const first = await claimNext(-1000); // a lease that expired a second ago

    const second = await claimNext();
    expect(second!.id).toEqual(first!.id);
    expect(second!.attempts).toEqual(2);
  });

  it("does not claim a job backed off into the future", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)]);
    const claimed = await claimNext();
    await retryJob(claimed!.id, 60_000);

    expect(await claimJobOfThisRun()).toBeNull();
  });
});

describe("cancelPending", () => {
  it("cancels pending jobs and spares running ones", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1), line(2), line(3)]);
    const running = await claimNext();

    expect(await cancelPending("stopped by hand", batch)).toEqual(2);

    const states = await stateCounts(batch);
    expect(states).toEqual({ running: 1, cancelled: 2 });
    expect(running).not.toBeNull();
  });

  it("leaves other batches alone when given a batch id", async () => {
    const mine = await newBatch();
    await enqueue(mine, [line(1)]);
    const theirs = await newBatch();
    await enqueue(theirs, [line(2)]);

    await cancelPending("stopped", mine);

    expect(await stateCounts(theirs)).toEqual({ pending: 1 });
  });
});

describe("snapshot", () => {
  it("sums real credits and counts unpriced takes separately", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1), line(2)]);
    const a = await claimNext();
    await finishJob(a!.id, { version: 1, credits: 55 });
    const b = await claimNext();
    await finishJob(b!.id, { version: 1, credits: null });

    const seen = await snapshot(null);
    expect(seen.credits).toBeGreaterThanOrEqual(55);
    expect(seen.unpriced).toBeGreaterThanOrEqual(1);
  });

  it("reports jobs finished after the cursor, and not before it", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1), line(2)]);

    const a = await claimNext();
    await finishJob(a!.id, { version: 3, credits: 55 });
    const afterFirst = await snapshot(null);
    expect(afterFirst.finished.map((job) => job.id)).toContain(a!.id);

    const b = await claimNext();
    await finishJob(b!.id, { version: 4, credits: 55 });
    const afterSecond = await snapshot(afterFirst.cursor);
    const ids = afterSecond.finished.map((job) => job.id);

    expect(ids).toContain(b!.id);
    expect(ids).not.toContain(a!.id);
    expect(afterSecond.finished.find((job) => job.id === b!.id)).toMatchObject({
      file: line(2).audioPath,
      version: 4,
    });
  });

  it("carries a failure's message rather than just a count", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)]);
    const job = await claimNext();
    await failJob(job!.id, { kind: "bad-request", message: "no line q:1:accept" });

    const seen = await snapshot(null);
    expect(seen.failures).toContainEqual({
      lineId: "q:1:accept",
      message: "no line q:1:accept",
    });
  });
});

/** Claim, but only accept a job this test run created. Other suites share the database. */
async function claimJobOfThisRun() {
  const job = await claimNext();
  return job && job.file.startsWith(prefix) ? job : null;
}

async function stateCounts(batchId: string): Promise<Record<string, number>> {
  const { rows } = await db().query<{ state: string; n: string }>(
    `select "state", count(*)::text as n from "regeneration_job"
      where "batchId" = $1 group by "state"`,
    [batchId],
  );
  return Object.fromEntries(rows.map((row) => [row.state, Number(row.n)]));
}
