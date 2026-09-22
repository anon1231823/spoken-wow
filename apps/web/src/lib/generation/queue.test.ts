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
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";

import { cancelPending, dismissThrough, claimNext, createBatch, enqueue, failJob, finishJob, retryJob, snapshot, type QueueEntry } from "./queue";
import type { Source } from "@/lib/sections";

/** A file prefix no other run collides with, so tests share one database safely. */
let prefix: string;
const batches: string[] = [];

function line(n: number): QueueEntry {
  return {
    lineId: `q:${n}:accept`,
    file: `${prefix}/${n}.mp3`,
    npcName: `NPC ${n}`,
    characters: 100,
    preview: `line ${n}`,
  };
}

async function newBatch(source: Source = "quests"): Promise<string> {
  const id = await createBatch("test batch", null, source);
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
    expect(await enqueue(first, [line(1), line(2)], "quests")).toEqual({ queued: 2, skipped: 0 });

    const second = await newBatch();
    expect(await enqueue(second, [line(2), line(3)], "quests")).toEqual({ queued: 1, skipped: 1 });
  });

  it("accepts a file again once its job has finished", async () => {
    const first = await newBatch();
    await enqueue(first, [line(1)], "quests");
    const claimed = await claimNext();
    await finishJob(claimed!.id, { version: 1, credits: 55 });

    const second = await newBatch();
    expect(await enqueue(second, [line(1)], "quests")).toEqual({ queued: 1, skipped: 0 });
  });

  /**
   * The reason the credit guard is keyed on the source and not the file alone. The two
   * sections name files by their own frozen rules and nothing keeps the namespaces apart, so
   * without this a zones job would silently block a quests one -- which reads as "nothing
   * happened when I pressed Regenerate", with nothing anywhere saying why.
   */
  it("does not let one section's queued file block the other's", async () => {
    const quests = await newBatch();
    expect(await enqueue(quests, [line(1)], "quests")).toEqual({ queued: 1, skipped: 0 });

    const zones = await newBatch("zones");
    expect(await enqueue(zones, [line(1)], "zones")).toEqual({ queued: 1, skipped: 0 });

    // Still one job per file within a source, which is what the guard is actually for.
    const again = await newBatch("zones");
    expect(await enqueue(again, [line(1)], "zones")).toEqual({ queued: 0, skipped: 1 });
  });

  it("tells the worker which generator a claimed job wants", async () => {
    const zones = await newBatch("zones");
    await enqueue(zones, [line(7)], "zones");

    const claimed = await claimNext();
    expect(claimed!.source).toBe("zones");
  });
});

describe("the language a job is in", () => {
  it("is English unless the batch says otherwise", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");
    expect((await claimJobOfThisRun())?.lang).toBe("enUS");
  });

  // A Portuguese take of a file is a different recording from the English one.
  it("keeps the same file in two languages as two jobs", async () => {
    const english = await newBatch();
    const portuguese = await createBatch("test batch", null, "quests", "ptBR");
    batches.push(portuguese);
    expect(await enqueue(english, [line(1)], "quests")).toEqual({ queued: 1, skipped: 0 });
    expect(await enqueue(portuguese, [line(1)], "quests", "ptBR")).toEqual({ queued: 1, skipped: 0 });
    expect(await enqueue(portuguese, [line(1)], "quests", "ptBR")).toEqual({ queued: 0, skipped: 1 });
  });

  // What the worker generates in, and what the snapshot tells a page it may adopt.
  it("rides from the enqueue to the claim", async () => {
    const id = await createBatch("test batch", null, "quests", "ptBR");
    batches.push(id);
    await enqueue(id, [line(1)], "quests", "ptBR");
    expect((await claimJobOfThisRun())?.lang).toBe("ptBR");
  });
});

describe("claimNext", () => {
  it("hands two concurrent callers different jobs", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1), line(2)], "quests");

    const [a, b] = await Promise.all([claimNext(), claimNext()]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).not.toEqual(b!.id);
  });

  it("returns null when nothing is due", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");
    await claimNext();

    // The one job is now running and its lease is live, so there is nothing to claim.
    expect(await claimJobOfThisRun()).toBeNull();
  });

  it("reclaims a job whose lease has expired", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");
    const first = await claimNext(-1000); // a lease that expired a second ago

    const second = await claimNext();
    expect(second!.id).toEqual(first!.id);
    expect(second!.attempts).toEqual(2);
  });

  it("does not claim a job backed off into the future", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");
    const claimed = await claimNext();
    await retryJob(claimed!.id, 60_000);

    expect(await claimJobOfThisRun()).toBeNull();
  });
});

describe("cancelPending", () => {
  it("cancels pending jobs and spares running ones", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1), line(2), line(3)], "quests");
    const running = await claimNext();

    expect(await cancelPending("stopped by hand", batch)).toEqual(2);

    const states = await stateCounts(batch);
    expect(states).toEqual({ running: 1, cancelled: 2 });
    expect(running).not.toBeNull();
  });

  it("leaves other batches alone when given a batch id", async () => {
    const mine = await newBatch();
    await enqueue(mine, [line(1)], "quests");
    const theirs = await newBatch();
    await enqueue(theirs, [line(2)], "quests");

    await cancelPending("stopped", mine);

    expect(await stateCounts(theirs)).toEqual({ pending: 1 });
  });
});

describe("snapshot", () => {
  it("sums real credits and counts unpriced takes separately", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1), line(2)], "quests");
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
    await enqueue(batch, [line(1), line(2)], "quests");

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
      file: line(2).file,
      version: 4,
    });
  });

  it("sees a job old enough to have fallen out of the window, because claimNext still can", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");
    // The queue starts lazily, so a batch interrupted by a deploy really can sit for days.
    // A snapshot that aged it out would render no panel at all - and therefore no Stop -
    // over a queue that is about to spend money.
    await db().query(
      `update "regeneration_job" set "queuedAt" = now() - interval '3 days' where "batchId" = $1`,
      [batch],
    );

    const seen = await snapshot(null);
    expect(seen.active).toBe(true);
    expect(seen.counts.pending).toBeGreaterThanOrEqual(1);
    expect(await claimNext()).not.toBeNull();
  });

  it("does not hang a stopped batch's reason on the next batch to run cleanly", async () => {
    const stoppedBatch = await newBatch();
    await enqueue(stoppedBatch, [line(1)], "quests");
    await cancelPending("Stopped by an admin", stoppedBatch);
    expect((await snapshot(null)).latestBatch).toMatchObject({
      cancelled: 1,
      stoppedBecause: "Stopped by an admin",
    });

    const cleanBatch = await newBatch();
    await enqueue(cleanBatch, [line(2)], "quests");
    const job = await claimNext();
    await finishJob(job!.id, { version: 1, credits: 55 });

    expect((await snapshot(null)).latestBatch).toEqual({
      cancelled: 0,
      stoppedBecause: null,
    });
  });

  it("answers one poll with two pooled queries, not seven", async () => {
    // The exact count that matters: a batch in flight already holds two connections per job,
    // so the number a poll opens on top of that is the tightest budget in the system. This
    // spies on the real pool rather than mocking it - every query below still runs against
    // Postgres, only the call count is observed.
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");

    const pool = db();
    const original = pool.query.bind(pool);
    let calls = 0;
    const spy = vi
      .spyOn(pool, "query")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((...args: any[]) => {
        calls++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (original as any)(...args);
      });

    try {
      await snapshot(null);
    } finally {
      spy.mockRestore();
    }

    expect(calls).toBe(2);
  });

  it("carries a failure's message rather than just a count", async () => {
    const batch = await newBatch();
    await enqueue(batch, [line(1)], "quests");
    const job = await claimNext();
    await failJob(job!.id, { kind: "bad-request", message: "no line q:1:accept" });

    const seen = await snapshot(null);
    expect(seen.failures).toContainEqual({
      source: "quests",
      lang: "enUS",
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

describe("dismissing finished work", () => {
  it("hides what was dismissed and keeps what came after", async () => {
    const batch = await createBatch("dismiss", null, "quests");
    batches.push(batch);
    await enqueue(batch, [line(1)], "quests");

    const first = await claimNext();
    await finishJob(first!.id, { version: 1, credits: 10 });

    const before = await snapshot(null);
    expect(before.counts.done).toBeGreaterThan(0);

    await dismissThrough(before.cursor, null);

    const after = await snapshot(null);
    expect(after.counts.done).toBe(0);
    expect(after.credits).toBe(0);

    // Work that finishes after the dismissal is news again.
    await enqueue(batch, [line(2)], "quests");
    const second = await claimNext();
    await finishJob(second!.id, { version: 1, credits: 10 });

    expect((await snapshot(null)).counts.done).toBe(1);
  });

  it("never hides work that is still running or pending", async () => {
    const batch = await createBatch("dismiss-live", null, "quests");
    batches.push(batch);
    await enqueue(batch, [line(3)], "quests");

    const done = await claimNext();
    await finishJob(done!.id, { version: 1, credits: 10 });
    await enqueue(batch, [line(4)], "quests");

    // Dismissing the finished job must leave the pending one - and the Stop button - alone.
    await dismissThrough((await snapshot(null)).cursor, null);
    const after = await snapshot(null);

    expect(after.counts.pending + after.counts.running).toBe(1);
    expect(after.active).toBe(true);
  });
});
