/**
 * The queue is real, ElevenLabs is not.
 *
 * The store is a real Postgres for the reason queue.test.ts gives - the exclusions live in
 * the schema - while the one call that would cost money is injected, exactly as tts.ts and
 * elevenlabs.ts inject theirs. No test may need an account and none may ever spend credits.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import type { BatchLine } from "@/lib/search";

import * as queue from "./queue";
import { createBatch, enqueue } from "./queue";
import type { RegenerateResult } from "./regenerate";
import { backoffFor, startWorker } from "./worker";

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

const OK: RegenerateResult = {
  ok: true,
  lineId: "q:1:accept",
  file: "x",
  version: 1,
  bytes: 10,
  characters: 100,
  credits: 55,
  seed: null,
  voice: "human-male",
  voiceId: "v",
  spokenText: "x",
  dictionaryVersion: null,
  sharedWith: 0,
  archivedInherited: false,
};

async function seed(count: number): Promise<string> {
  const id = await createBatch("test", null as unknown as string);
  batches.push(id);
  await enqueue(id, Array.from({ length: count }, (_, i) => line(i + 1)));
  return id;
}

async function statesOf(batchId: string): Promise<Record<string, number>> {
  const { rows } = await db().query<{ state: string; n: string }>(
    `select "state", count(*)::text as n from "regeneration_job"
      where "batchId" = $1 group by "state"`,
    [batchId],
  );
  return Object.fromEntries(rows.map((row) => [row.state, Number(row.n)]));
}

/** Poll until `check` passes or the deadline, so tests never race the drain loop. */
async function until(check: () => Promise<boolean>, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition not met in time");
}

beforeEach(() => {
  prefix = `test-worker-${Math.random().toString(36).slice(2, 10)}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (batches.length) {
    await db().query(`delete from "regeneration_batch" where "id" = any($1::uuid[])`, [batches]);
    batches.length = 0;
  }
});

afterAll(async () => {
  await closeDb();
});

describe("backoffFor", () => {
  it("grows exponentially and is fully jittered", () => {
    expect(backoffFor(1, () => 1)).toBe(3_000);
    expect(backoffFor(2, () => 1)).toBe(6_000);
    expect(backoffFor(3, () => 1)).toBe(12_000);
    // Full jitter: anything from zero up to the ceiling, so retries do not resynchronise.
    expect(backoffFor(2, () => 0)).toBe(0);
  });
});

/**
 * The owner's key, injected.
 *
 * Every job is generated with the key of whoever queued it, so a worker built without this
 * reads the real `elevenlabs_key` table, finds no row for a seeded job's owner, and fails
 * the batch as unauthenticated before any of these tests get to their point. Sealing a key
 * into the test database instead would put a credential path in the way of tests that are
 * about the queue.
 */
const KEYED = async () => "test-key";

describe("startWorker", () => {
  it("drains the queue to empty", async () => {
    const batch = await seed(5);
    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      regenerate: async () => OK,
      budget: async () => 3,
    });

    await until(async () => (await statesOf(batch)).done === 5);
    await worker.stop();
  });

  it("never exceeds the budget", async () => {
    const batch = await seed(10);
    let peak = 0;
    let live = 0;

    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 3,
      regenerate: async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((resolve) => setTimeout(resolve, 20));
        live -= 1;
        return OK;
      },
    });

    await until(async () => (await statesOf(batch)).done === 10);
    await worker.stop();

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("claims nothing while it does not lead", async () => {
    const batch = await seed(3);
    const worker = startWorker(() => false, { apiKeyFor: KEYED, regenerate: async () => OK });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await statesOf(batch)).toEqual({ pending: 3 });

    await worker.stop();
  });

  it("cancels the rest of a batch after a fatal failure", async () => {
    const batch = await seed(5);
    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      regenerate: async () => ({
        ok: false,
        failure: {
          kind: "quota",
          message: "quota_exceeded: you are out of credits",
          status: 402,
          fatal: true,
        },
      }),
    });

    await until(async () => {
      const states = await statesOf(batch);
      return (states.cancelled ?? 0) === 4 && (states.failed ?? 0) === 1;
    });
    await worker.stop();

    const { rows } = await db().query<{ stoppedBecause: string }>(
      `select "stoppedBecause" from "regeneration_batch" where "id" = $1`,
      [batch],
    );
    expect(rows[0].stoppedBecause).toContain("out of credits");
  });

  /**
   * The batch is enqueued by someone who had a key at the time, so reaching the worker
   * without one means it was cleared or the master key changed underneath it. Every
   * remaining job would be refused identically, which is what makes this fatal - and no
   * request is made, so nothing is spent finding out.
   */
  it("abandons a batch whose owner has no usable key, without generating", async () => {
    const batch = await seed(4);
    let generated = 0;
    const worker = startWorker(() => true, {
      apiKeyFor: async () => null,
      budget: async () => 1,
      regenerate: async () => {
        generated += 1;
        return OK;
      },
    });

    await until(async () => {
      const states = await statesOf(batch);
      return (states.cancelled ?? 0) === 3 && (states.failed ?? 0) === 1;
    });
    await worker.stop();

    expect(generated).toBe(0);

    const { rows } = await db().query<{ stoppedBecause: string }>(
      `select "stoppedBecause" from "regeneration_batch" where "id" = $1`,
      [batch],
    );
    expect(rows[0].stoppedBecause).toContain("ElevenLabs key");
  });

  it("keeps going after a failure that is not fatal", async () => {
    const batch = await seed(3);
    let first = true;

    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      regenerate: async () => {
        if (first) {
          first = false;
          return {
            ok: false as const,
            failure: {
              kind: "bad-request" as const,
              message: "its text still holds one of $<>",
              status: 422,
              fatal: false,
            },
          };
        }
        return OK;
      },
    });

    await until(async () => {
      const states = await statesOf(batch);
      return (states.done ?? 0) === 2 && (states.failed ?? 0) === 1;
    });
    await worker.stop();
  });

  it("gives up on a rate-limited job after MAX_ATTEMPTS", async () => {
    const batch = await seed(1);
    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      // Zero base, so the test does not wait out a real backoff.
      backoffMs: () => 0,
      regenerate: async () => ({
        ok: false,
        failure: {
          kind: "rate-limit",
          message: "too_many_concurrent_requests",
          status: 429,
          fatal: false,
        },
      }),
    });

    await until(async () => (await statesOf(batch)).failed === 1);
    await worker.stop();

    const { rows } = await db().query<{ attempts: number }>(
      `select "attempts" from "regeneration_job" where "batchId" = $1`,
      [batch],
    );
    expect(rows[0].attempts).toBe(3);
  });

  it("fails a rate-limited job rather than requeueing it once its batch is stopped", async () => {
    const batch = await seed(1);
    await db().query(
      `update "regeneration_batch" set "stoppedAt" = now(), "stoppedBecause" = 'Stopped'
        where "id" = $1`,
      [batch],
    );

    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      backoffMs: () => 0,
      regenerate: async () => ({
        ok: false,
        failure: {
          kind: "rate-limit",
          message: "too_many_concurrent_requests",
          status: 429,
          fatal: false,
        },
      }),
    });

    await until(async () => (await statesOf(batch)).failed === 1);
    await worker.stop();

    // One attempt, not three: a retry would put the row back to `pending`, where it would be
    // claimed and paid for after someone pressed Stop - and where it would flip the queue
    // back to active, so the panel would return to "Regenerating" having just said "Stopped".
    const { rows } = await db().query<{ attempts: number }>(
      `select "attempts" from "regeneration_job" where "batchId" = $1`,
      [batch],
    );
    expect(rows[0].attempts).toBe(1);
  });
});

describe("stop()", () => {
  it("hands a claim already in flight back to the queue rather than starting it", async () => {
    const batch = await seed(1);

    // Holds the real claimNext round trip in flight so the test can land stop() in the
    // exact window the fix closes: after a claim has started, before it has resolved.
    let resolveClaimStarted!: () => void;
    const claimStarted = new Promise<void>((resolve) => {
      resolveClaimStarted = resolve;
    });
    let releaseClaim!: () => void;
    const realClaimNext = queue.claimNext;
    vi.spyOn(queue, "claimNext").mockImplementation(async (leaseMs) => {
      resolveClaimStarted();
      await new Promise<void>((resolve) => {
        releaseClaim = resolve;
      });
      return realClaimNext(leaseMs);
    });

    let regenerateCalls = 0;
    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      regenerate: async () => {
        regenerateCalls += 1;
        return OK;
      },
    });

    await claimStarted;
    // running is still empty here - the claim has not resolved - so stop() has nothing
    // to await yet and returns almost immediately. Releasing the claim afterwards is
    // what lets it resolve with a job while `stopped` is already true.
    const stopped = worker.stop();
    releaseClaim();
    await stopped;

    // The row lands back in "pending" (via retryJob) only once the claim, now stopped,
    // has been handed back; poll rather than assume it beat this assertion.
    await until(async () => (await statesOf(batch)).pending === 1);

    expect(worker.inFlight()).toBe(0);
    expect(regenerateCalls).toBe(0);
  });

  it("awaits a job whose regenerate call is genuinely in flight before resolving", async () => {
    const batch = await seed(1);

    let resolveStarted!: () => void;
    const regenerateStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let releaseRegenerate!: () => void;

    const worker = startWorker(() => true, {
      apiKeyFor: KEYED,
      budget: async () => 1,
      regenerate: async () => {
        resolveStarted();
        await new Promise<void>((resolve) => {
          releaseRegenerate = resolve;
        });
        return OK;
      },
    });

    await regenerateStarted;
    expect(worker.inFlight()).toBe(1);

    const stopPromise = worker.stop();
    let settled = false;
    void stopPromise.then(() => {
      settled = true;
    });

    // The regenerate call is still deliberately blocked, so stop() must still be
    // waiting on it - dropping it here is exactly what would bill ElevenLabs for audio
    // nobody gets. A couple of microtask ticks is enough to prove it has not resolved
    // early without depending on wall-clock timing.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseRegenerate();
    await stopPromise;

    expect(worker.inFlight()).toBe(0);
    expect(await statesOf(batch)).toEqual({ done: 1 });
  });
});
