/**
 * The drain loop.
 *
 * What Explorer.runBatch used to be, moved to the server and no longer sequential: while
 * this process leads, it keeps up to the plan's budget of regenerations in flight, claiming
 * another whenever one settles.
 *
 * The single call that costs money is injectable for the reason tts.ts injects fetch: no
 * test may need an ElevenLabs account, and none may ever spend credits. Everything else here
 * runs against the real queue, because the exclusions that keep it honest are in the schema.
 */
import { readApiKey } from "@/lib/api-key";
import { POOL_MAX } from "@/lib/db";

import { budgetFor, afterRateLimit, clampToPool } from "./concurrency";
import {
  batchStopped,
  cancelPending,
  claimNext,
  failJob,
  finishJob,
  retryJob,
  type QueueJob,
  type Source,
} from "./queue";
import { regenerateLine, type RegenerateResult } from "./regenerate";
import { publish as publishBooks, regenerateBookLine } from "@/lib/books/regenerate";
import { publish as publishZones, regenerateZoneLine } from "@/lib/zones/regenerate";
import { readSettings } from "./settings";
import { generationStatus } from "./status";

/**
 * How many times a rate-limited job is retried before it is failed.
 *
 * Three rather than forever: a limit that has not lifted in three backoffs is a condition
 * someone needs to see, not one to keep spending requests on.
 */
export const MAX_ATTEMPTS = 3;

export const BACKOFF_BASE_MS = 3_000;

/**
 * Exponential backoff with full jitter, as ElevenLabs recommends.
 *
 * Full jitter rather than a fixed delay because a rate limit hits several in-flight jobs at
 * once, and retrying them all after the same interval reproduces the burst that caused it.
 */
export function backoffFor(attempts: number, random: () => number = Math.random): number {
  return Math.floor(random() * BACKOFF_BASE_MS * 2 ** (attempts - 1));
}

/**
 * The budget the account currently allows, from the tier and the model in force.
 *
 * Clamped to what the pool can serve: an ElevenLabs plan the account is upgraded to next year
 * must not be able to raise this past the number of connections available to spend it, which
 * is a deadlock rather than a slow batch.
 *
 * The key says whose plan. Every job is generated with its own owner's credentials now, so
 * there is no one account to ask about - the caller passes the last one it claimed for. With
 * none, budgetFor's floor of one applies, which is the right answer before the first claim:
 * one job is enough to learn who is next.
 */
export async function currentBudget(apiKey: string | null = null): Promise<number> {
  const [status, settings] = await Promise.all([
    generationStatus(apiKey ? { apiKey } : {}),
    readSettings(),
  ]);
  const plan = budgetFor(status.subscription?.tier ?? null, settings.config.modelId);
  return clampToPool(plan, POOL_MAX);
}

/**
 * How one job is generated.
 *
 * A function per source rather than one that switches inside, so adding a section is adding
 * an entry here and the loop below stays the loop. Every one takes the same three arguments
 * because that is all a job carries: which line, whose credits, and the key to spend them.
 */
export type Generator = (
  lineId: string,
  userId: string,
  options: { apiKey: string },
) => Promise<RegenerateResult>;

export type WorkerOptions = {
  /**
   * Overrides per source, for tests. A source with no entry falls back to the real
   * generator for it; there is no default that would quietly generate the wrong corpus.
   */
  regenerate?: Partial<Record<Source, Generator>>;
  budget?: (apiKey: string | null) => Promise<number>;
  /**
   * Run once after the queue empties, per source that generated anything.
   *
   * The zones side has to rebuild the addon's lookup table after a take changes, and that
   * rewrites all 1,353 rows -- doing it per line would be the slowest part of a run that is
   * otherwise waiting on ElevenLabs. Per drain rather than per batch, because two batches
   * can be in flight and the answer is the same either way.
   */
  afterDrain?: Partial<Record<Source, () => Promise<void>>>;
  /** The owner's stored key. Injectable so a test never needs one sealed in a database. */
  apiKeyFor?: (userId: string) => Promise<string | null>;
  backoffMs?: (attempts: number) => number;
  leaseMs?: number;
  /** How long to wait before looking again when the queue was empty. */
  idleMs?: number;
};

export type Worker = {
  stop(): Promise<void>;
  /** Look for work now rather than at the next idle tick. Called after an enqueue. */
  nudge(): void;
  inFlight(): number;
};

export function startWorker(isLeader: () => boolean, options: WorkerOptions = {}): Worker {
  // A source with no generator cannot have its jobs claimed, and a claim for one is a bug
  // rather than a state to handle - it fails as one, loudly, rather than being handed to
  // the quests generator and asked for a line id that corpus has never heard of. The
  // Record is total on purpose: adding a source to the type and forgetting it here is a
  // type error, which is how books arrived without a silent gap.
  const generators: Record<Source, Generator | null> = {
    quests: options.regenerate?.quests ?? regenerateLine,
    zones: options.regenerate?.zones ?? regenerateZoneLine,
    books: options.regenerate?.books ?? regenerateBookLine,
  };

  // Only the sources that actually generated something this drain. Publishing for a
  // section nobody touched would rewrite a table for no reason, and doing it on a drain
  // that generated nothing at all -- which is every idle tick -- would do it forever.
  // Per drain rather than per line for both: each rewrites its whole lookup table, and
  // doing that per take would be the slowest part of a run otherwise spent waiting on
  // ElevenLabs. Quests has no entry because its addon reads the corpus it already ships.
  const afterDrain: Partial<Record<Source, () => Promise<void>>> = options.afterDrain ?? {
    zones: () => publishZones(),
    books: () => publishBooks(),
  };
  const generated = new Set<Source>();
  const budget = options.budget ?? currentBudget;
  const apiKeyFor = options.apiKeyFor ?? readApiKey;
  const backoff = options.backoffMs ?? backoffFor;
  const idleMs = options.idleMs ?? 2_000;

  const running = new Set<Promise<void>>();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let pumping = false;
  /** When a 429 was last seen, which halves the budget for the cool-down. */
  let rateLimitedAt: number | null = null;
  /**
   * The key the last claimed job was generated with, for sizing the next pump.
   *
   * The budget belongs to a plan, and which plan depends on whose key. Reading it per pump
   * from the job most recently claimed is close enough: a queue holding two people's batches
   * is rare, and the cost of guessing the wrong one is a batch that runs at the other's
   * width for a tick.
   */
  let lastKey: string | null = null;

  async function run(job: QueueJob): Promise<void> {
    // Whose credits this line is spent from. A batch is enqueued by someone who had a key at
    // the time, so reaching here without one means it was cleared or the master key changed
    // underneath it - and every remaining job in the batch would fail identically.
    let apiKey: string | null;
    try {
      apiKey = await apiKeyFor(job.createdBy ?? "");
    } catch {
      apiKey = null;
    }

    if (!apiKey) {
      const message =
        "the account that started this batch has no usable ElevenLabs key; set one in your" +
        " profile and start it again";
      try {
        await failJob(job.id, { kind: "auth", message });
        await cancelPending(`Stopped after auth: ${message}`, job.batchId);
      } catch (error) {
        console.error(`regeneration queue: job ${job.id} could not be failed`, error);
      }
      return;
    }
    lastKey = apiKey;
    generated.add(job.source);

    const generate = generators[job.source];
    if (!generate) {
      const message = `no generator for ${job.source} jobs in this build`;
      try {
        await failJob(job.id, { kind: "bad-request", message });
        await cancelPending(`Stopped: ${message}`, job.batchId);
      } catch (error) {
        console.error(`regeneration queue: job ${job.id} could not be failed`, error);
      }
      return;
    }

    // A batch whose owner's account was deleted still has takes to attribute, and
    // take."createdBy" is nullable for exactly that case.
    const result = await generate(job.lineId, job.createdBy ?? "", { apiKey }).catch(
      (error: unknown): RegenerateResult => ({
        ok: false,
        failure: {
          kind: "upstream",
          message: error instanceof Error ? error.message : String(error),
          status: 502,
          fatal: false,
        },
      }),
    );

    // Recording the outcome is wrapped because a database blip here is expensive in a way a
    // failed generation is not: the money has already been spent, and a row left `running`
    // has its lease reclaimed five minutes later and the same file generated and paid for a
    // second time. Nothing can be done about it from here beyond saying so loudly enough that
    // the log explains the duplicate charge.
    try {
      if (result.ok) {
        await finishJob(job.id, { version: result.version, credits: result.credits });
        return;
      }

      const { kind, message, fatal } = result.failure;

      if (kind === "rate-limit") {
        rateLimitedAt = Date.now();
        // A retry puts the row back to `pending`, where it would be claimed and paid for
        // after an admin pressed Stop - and where it would flip the queue back to active, so
        // the panel returns to "Regenerating" having just said "Stopped". Stop means stop.
        if (job.attempts < MAX_ATTEMPTS && !(await batchStopped(job.batchId))) {
          await retryJob(job.id, backoff(job.attempts));
          return;
        }
      }

      await failJob(job.id, { kind, message });

      // Out of credits, a bad key or a missing voice fails every remaining line in the same
      // way. Grinding through the rest of the batch to learn that once per line is exactly
      // what the fatal flag exists to prevent - the reasoning is written out in errors.ts.
      if (fatal) {
        await cancelPending(`Stopped after ${kind}: ${message}`, job.batchId);
      }
    } catch (error) {
      console.error(
        `regeneration queue: job ${job.id} (${job.file}) settled but its outcome could not be` +
          ` recorded; it will be reclaimed after its lease and generated again`,
        error,
      );
    }
  }

  /**
   * Fill the free slots, then arrange to be called again.
   *
   * Guarded by `pumping` because a job settling calls this at the same time as the idle
   * timer, and two pumps interleaving would claim past the budget.
   */
  async function pump(): Promise<void> {
    if (pumping || stopped) return;
    pumping = true;
    try {
      if (!isLeader()) return;

      const allowed = afterRateLimit(await budget(lastKey), rateLimitedAt, Date.now());

      while (!stopped && isLeader() && running.size < allowed) {
        const job = await claimNext(options.leaseMs);
        if (!job) {
          // Nothing left to claim. If work is still settling, the pump that follows it
          // will come back here with running.size at zero and publish then.
          if (running.size === 0) await drain();
          return;
        }

        if (stopped) {
          // A stop landed while this claim's round trip was in flight. claimNext already
          // marked the row "running" and spent one of its attempts; handing it back with
          // retryJob rather than starting it is what keeps a rolling deploy's SIGTERM from
          // stranding the row for its whole five-minute lease. Losing an attempt to a
          // deploy that never actually tried the job is the fair side of that trade.
          await retryJob(job.id, 0);
          return;
        }

        const work = run(job).finally(() => {
          running.delete(work);
          // Settling frees a slot, so look for the next job immediately rather than waiting
          // out an idle tick - that wait is what would make this only nominally parallel.
          if (!stopped) void pump();
        });
        running.add(work);
      }
    } catch {
      // A database blip must not kill the loop; the next tick tries again.
    } finally {
      pumping = false;
      if (!stopped && !timer) {
        timer = setTimeout(() => {
          timer = null;
          void pump();
        }, idleMs);
      }
    }
  }

  /**
   * Publish what this drain generated, once.
   *
   * Failures are logged rather than thrown: the takes are already on disk and in the
   * table, so a lookup that could not be rewritten is a stale addon table rather than a
   * lost line, and the next drain rebuilds it. Throwing here would take down the pump.
   */
  async function drain(): Promise<void> {
    if (generated.size === 0) return;
    const sources = [...generated];
    generated.clear();

    for (const source of sources) {
      const publish = afterDrain[source];
      if (!publish) continue;
      try {
        await publish();
      } catch (error) {
        console.error(`regeneration queue: could not publish ${source} after a drain`, error);
      }
    }
  }

  void pump();

  return {
    nudge: () => void pump(),
    inFlight: () => running.size,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      // Looped rather than a single snapshot: a claim already in flight when stop() was
      // called can still land in `running` after the first snapshot is taken (the check
      // above closes that for new claims, but this is what makes "stopped" mean quiescent
      // rather than merely likely). Awaited rather than abandoned either way: these
      // requests are already at ElevenLabs and will be billed, so dropping them would pay
      // for audio nobody gets. This is what makes kill_timeout in ecosystem.config.js
      // load-bearing.
      while (running.size > 0) {
        await Promise.allSettled([...running]);
      }
    },
  };
}
