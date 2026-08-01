/**
 * Every SQL statement the regeneration queue needs, and nothing else.
 *
 * No ElevenLabs, no leadership, no timers: this module is the store, and it is the only one
 * that knows the column names. worker.ts decides what to do; this decides what is written.
 *
 * Rows are keyed on the file for the reason migration 0013 records - a job is one mp3, not
 * one line - and the exclusions that keep the queue honest live in the schema, not here.
 */
import { db } from "@/lib/db";
import type { BatchLine } from "@/lib/search";

export type JobState = "pending" | "running" | "done" | "failed" | "cancelled";

/** A claimed job, with the batch's owner joined in so the take records who paid for it. */
export type QueueJob = {
  /** bigserial, which `pg` returns as a string. Kept as one so nothing rounds it. */
  id: string;
  batchId: string;
  lineId: string;
  file: string;
  npcName: string;
  preview: string;
  characters: number;
  attempts: number;
  createdBy: string | null;
};

export type QueueSnapshot = {
  /** Whether anything is pending or running, which is what drives the poll interval. */
  active: boolean;
  counts: Record<JobState, number>;
  /** Summed from what ElevenLabs charged, never from the estimate. */
  credits: number;
  /** Takes ElevenLabs did not price, counted rather than assumed to be free. */
  unpriced: number;
  running: { lineId: string; npcName: string; preview: string }[];
  failures: { lineId: string; message: string }[];
  /**
   * The newest batch's own stop, or null when there is no batch at all.
   *
   * Scoped to that one batch while the counts above stay global, because "Stopped" and the
   * reason under it are claims about a particular batch: read from the whole window they
   * would put yesterday's stop reason on today's clean run.
   */
  latestBatch: { cancelled: number; stoppedBecause: string | null } | null;
  /** Jobs that reached `done` after the cursor, for the page to adopt. */
  finished: { id: string; lineId: string; file: string; version: number }[];
  /** Pass back as `since` on the next poll. */
  cursor: string;
};

export const DEFAULT_LEASE_MS = 5 * 60_000;

/**
 * How long a *finished* batch stays in the snapshot after it drains.
 *
 * The panel has to keep saying "Finished" after the last job lands, so the window cannot be
 * "has unfinished work". A day is long enough that nobody loses a result they were watching
 * and short enough that the query stays small.
 *
 * It applies only to terminal rows. Pending and running jobs are counted however old they
 * are, because claimNext has no window: it will claim and pay for a job queued a week ago,
 * and a snapshot that could not see it would render no panel at all - no progress, no credit
 * total and, worst of all, no Stop button for a queue that is spending money.
 */
const WINDOW = "24 hours";

/** Batches older than this are deleted outright, jobs cascading with them. */
const RETENTION = "30 days";

/** How many finished jobs one poll carries. Enough that a tab which slept catches up fast. */
const FINISHED_PAGE = 500;

export async function createBatch(label: string, createdBy: string | null): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into "regeneration_batch" ("label", "createdBy") values ($1, $2) returning "id"`,
    [label, createdBy],
  );
  return rows[0].id;
}

/**
 * Add jobs, refusing any file already queued.
 *
 * ON CONFLICT against regeneration_job_one_per_file, so two overlapping searches cannot pay
 * for the same mp3 twice. The count of refusals is returned rather than swallowed: "4,000
 * queued, 900 already queued" is the honest answer, and hiding it would make the panel's
 * totals disagree with what was asked for.
 */
export async function enqueue(
  batchId: string,
  jobs: BatchLine[],
): Promise<{ queued: number; skipped: number }> {
  if (jobs.length === 0) return { queued: 0, skipped: 0 };

  // Old batches are pruned here rather than on a schedule, because this is the only path
  // that grows the table and there is no cron on the droplet.
  await db().query(
    `delete from "regeneration_batch" where "createdAt" < now() - interval '${RETENTION}'`,
  );

  const { rowCount } = await db().query(
    `insert into "regeneration_job"
       ("batchId", "lineId", "file", "npcName", "preview", "characters")
     select $1, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[])
     on conflict ("file") where "state" in ('pending', 'running') do nothing`,
    [
      batchId,
      jobs.map((job) => job.lineId),
      jobs.map((job) => job.audioPath),
      jobs.map((job) => job.npcName),
      jobs.map((job) => job.preview),
      jobs.map((job) => job.characters),
    ],
  );

  const queued = rowCount ?? 0;
  return { queued, skipped: jobs.length - queued };
}

/**
 * Take the next due job, or null.
 *
 * One statement, because dequeuing and reclaiming an abandoned job are the same operation
 * seen from two sides. SKIP LOCKED is not strictly required under a single leader, but it
 * costs nothing and it is what keeps this correct during the seconds when a heartbeat has
 * stood one process down and another has not yet stood up.
 *
 * A negative `leaseMs` is how the tests produce an already-expired lease.
 */
export async function claimNext(leaseMs: number = DEFAULT_LEASE_MS): Promise<QueueJob | null> {
  const { rows } = await db().query<QueueJob>(
    `update "regeneration_job" as j set
        "state"      = 'running',
        "attempts"   = j."attempts" + 1,
        "leaseUntil" = now() + make_interval(secs => $1),
        "startedAt"  = coalesce(j."startedAt", now())
      where j."id" = (
        select "id" from "regeneration_job"
         where ("state" = 'pending' and "notBefore" <= now())
            or ("state" = 'running' and "leaseUntil" < now())
         order by "id"
         for update skip locked
         limit 1
      )
      returning j."id"::text, j."batchId", j."lineId", j."file", j."npcName", j."preview",
                j."characters", j."attempts",
                (select b."createdBy" from "regeneration_batch" b where b."id" = j."batchId")
                  as "createdBy"`,
    [leaseMs / 1000],
  );
  return rows[0] ?? null;
}

export async function finishJob(
  id: string,
  result: { version: number; credits: number | null },
): Promise<void> {
  await db().query(
    `update "regeneration_job"
        set "state" = 'done', "version" = $2, "credits" = $3,
            "finishedAt" = now(), "leaseUntil" = null
      where "id" = $1`,
    [id, result.version, result.credits],
  );
}

export async function failJob(
  id: string,
  failure: { kind: string; message: string },
): Promise<void> {
  await db().query(
    `update "regeneration_job"
        set "state" = 'failed', "errorKind" = $2, "error" = $3,
            "finishedAt" = now(), "leaseUntil" = null
      where "id" = $1`,
    [id, failure.kind, failure.message],
  );
}

/** Put a job back, due after `delayMs`. Used only to back off a rate limit. */
export async function retryJob(id: string, delayMs: number): Promise<void> {
  await db().query(
    `update "regeneration_job"
        set "state" = 'pending', "notBefore" = now() + make_interval(secs => $2),
            "leaseUntil" = null
      where "id" = $1`,
    [id, delayMs / 1000],
  );
}

/**
 * Cancel everything still waiting, optionally within one batch.
 *
 * Running jobs are untouched: the characters are already at ElevenLabs and will be billed,
 * so discarding the audio would pay for nothing. Returns how many were cancelled.
 */
export async function cancelPending(because: string, batchId?: string): Promise<number> {
  const { rowCount } = await db().query(
    `update "regeneration_job" set "state" = 'cancelled', "finishedAt" = now()
      where "state" = 'pending' and ($1::uuid is null or "batchId" = $1)`,
    [batchId ?? null],
  );

  // Only batches that actually lost work are stamped. Stamping every unstopped batch would
  // put "Stopped by an admin" on ones that had already finished cleanly, and the panel reads
  // the most recent reason it can find.
  await db().query(
    `update "regeneration_batch" as b
        set "stoppedAt" = now(), "stoppedBecause" = $1
      where b."stoppedAt" is null
        and ($2::uuid is null or b."id" = $2)
        and exists (select 1 from "regeneration_job" j
                     where j."batchId" = b."id" and j."state" = 'cancelled')`,
    [because, batchId ?? null],
  );

  return rowCount ?? 0;
}

/**
 * Whether this batch has been stopped.
 *
 * Asked by the worker before it hands a failed job back to the queue: a job put back to
 * `pending` after Stop ran would be claimed and paid for later, which is not what the person
 * who pressed it asked for.
 */
export async function batchStopped(batchId: string): Promise<boolean> {
  const { rows } = await db().query<{ stopped: boolean }>(
    `select "stoppedAt" is not null as stopped from "regeneration_batch" where "id" = $1`,
    [batchId],
  );
  return rows[0]?.stopped === true;
}

/**
 * The whole queue as the panel needs it.
 *
 * Scoped to the last day rather than to one batch: there is one ElevenLabs account and one
 * budget, so a batch someone else started is spending the same money and belongs on screen.
 */
export async function snapshot(since: string | null): Promise<QueueSnapshot> {
  // Live work first, then whatever finished recently: the two halves of what the panel is
  // for. Never just the age, for the reason WINDOW records.
  const window = `("state" in ('pending', 'running') or "queuedAt" > now() - interval '${WINDOW}')`;

  const [counts, totals, running, failures, latest, finished, cursor] = await Promise.all([
    db().query<{ state: JobState; n: string }>(
      `select "state", count(*)::text as n from "regeneration_job"
        where ${window} group by "state"`,
    ),
    db().query<{ credits: string; unpriced: string }>(
      `select coalesce(sum("credits"), 0)::text as credits,
              count(*) filter (where "state" = 'done' and "credits" is null)::text as unpriced
         from "regeneration_job" where ${window}`,
    ),
    db().query<{ lineId: string; npcName: string; preview: string }>(
      `select "lineId", "npcName", "preview" from "regeneration_job"
        where "state" = 'running' order by "id" limit 20`,
    ),
    db().query<{ lineId: string; message: string }>(
      `select "lineId", "error" as message from "regeneration_job"
        where "state" = 'failed' and ${window} order by "id" desc limit 20`,
    ),
    db().query<{ stoppedBecause: string | null; cancelled: string }>(
      `select b."stoppedBecause",
              (select count(*)::text from "regeneration_job" j
                where j."batchId" = b."id" and j."state" = 'cancelled') as cancelled
         from "regeneration_batch" b order by b."createdAt" desc limit 1`,
    ),
    db().query<{ id: string; lineId: string; file: string; version: number }>(
      `select "id"::text, "lineId", "file", "version" from "regeneration_job"
        where "state" = 'done' and "version" is not null and "id" > coalesce($1::bigint, 0)
        order by "id" limit ${FINISHED_PAGE}`,
      [since],
    ),
    db().query<{ max: string | null }>(
      `select max("id")::text as max from "regeneration_job"
        where "state" in ('done', 'failed')`,
    ),
  ]);

  const byState = Object.fromEntries(counts.rows.map((row) => [row.state, Number(row.n)]));
  const zero: Record<JobState, number> = {
    pending: 0,
    running: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };

  return {
    active: (byState.pending ?? 0) + (byState.running ?? 0) > 0,
    counts: { ...zero, ...byState },
    credits: Number(totals.rows[0].credits),
    unpriced: Number(totals.rows[0].unpriced),
    running: running.rows,
    failures: failures.rows,
    latestBatch: latest.rows[0]
      ? {
          cancelled: Number(latest.rows[0].cancelled),
          stoppedBecause: latest.rows[0].stoppedBecause,
        }
      : null,
    finished: finished.rows,
    // Normally the high-water mark of *all* terminal jobs, not just the page returned, so a
    // cursor never sticks behind a job that failed rather than finished. But a full page
    // means there are more done jobs than fit, and taking the global maximum then would skip
    // every one after it - lines the page would never learn had been regenerated. A full page
    // therefore ends at its own last row, and the next poll picks up from there.
    cursor:
      finished.rows.length === FINISHED_PAGE
        ? finished.rows[finished.rows.length - 1].id
        : (cursor.rows[0]?.max ?? since ?? "0"),
  };
}
