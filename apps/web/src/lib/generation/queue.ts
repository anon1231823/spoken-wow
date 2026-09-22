/**
 * Every SQL statement the regeneration queue needs, and nothing else.
 *
 * No ElevenLabs, no leadership, no timers: this module is the store, and it is the only one
 * that knows the column names. worker.ts decides what to do; this decides what is written.
 *
 * Rows are keyed on the file for the reason migration 0013 records - a job is one mp3, not
 * one line - and the exclusions that keep the queue honest live in the schema, not here.
 *
 * ONE QUEUE FOR BOTH SECTIONS. There is one ElevenLabs plan behind it, the panel shows what
 * everyone is spending, and two queues would need a scheduler between them to decide which
 * is allowed to run. The source rides on each job and decides which generator worker.ts
 * hands it to; it is also half the credit guard's key, because the two sides name files by
 * their own frozen rules and a collision would mean one section's job silently blocking the
 * other's - which reads as "nothing happened when I pressed Regenerate".
 *
 * THE LANGUAGE RIDES ON EACH JOB TOO, and is the guard's third term for the same reason: a
 * Portuguese take of a file is a different recording from the English one, and queueing both
 * is two jobs rather than a duplicate. It is what the generator is asked to speak in.
 */
import { db } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import type { Source } from "@/lib/sections";

export type JobState = "pending" | "running" | "done" | "failed" | "cancelled";


/**
 * One unit of work, in terms both sections can express.
 *
 * npcName and preview are denormalised from whatever corpus this came from, so that polling
 * every two seconds - and the worker itself - never need to load one. The zones side has no
 * NPC and puts the zone's name there; what the column is for is a label the panel can show.
 */
export type QueueEntry = {
  lineId: string;
  file: string;
  npcName: string;
  preview: string;
  characters: number;
};

/** A claimed job, with the batch's owner joined in so the take records who paid for it. */
export type QueueJob = {
  /** bigserial, which `pg` returns as a string. Kept as one so nothing rounds it. */
  id: string;
  batchId: string;
  source: Source;
  lang: Lang;
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
  running: { source: Source; lang: Lang; lineId: string; npcName: string; preview: string }[];
  failures: { source: Source; lang: Lang; lineId: string; message: string }[];
  /**
   * The newest batch's own stop, or null when there is no batch at all.
   *
   * Scoped to that one batch while the counts above stay global, because "Stopped" and the
   * reason under it are claims about a particular batch: read from the whole window they
   * would put yesterday's stop reason on today's clean run.
   */
  latestBatch: { cancelled: number; stoppedBecause: string | null } | null;
  /**
   * Jobs that reached `done` after the cursor, for the page to adopt.
   *
   * Carries the source because two explorers poll the same queue, and each may only adopt
   * its own: a quests page told that '1411/razor-hill' is now at version 3 would look for a
   * line it does not have. The language for the same reason one level down: an English page
   * adopting a Portuguese version number would point its player at a take it cannot play.
   */
  finished: { id: string; source: Source; lang: Lang; lineId: string; file: string; version: number }[];
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

export async function createBatch(
  label: string,
  createdBy: string | null,
  source: Source,
  lang: Lang = BASE_LANG,
): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into "regeneration_batch" ("label", "createdBy", "source", "lang")
     values ($1, $2, $3, $4) returning "id"`,
    [label, createdBy, source, lang],
  );
  return rows[0].id;
}

/**
 * Add jobs, refusing any file already queued.
 *
 * ON CONFLICT against regeneration_job_one_per_lang_file, so two overlapping searches cannot
 * pay for the same mp3 in the same language twice. The count of refusals is returned rather than swallowed: "4,000
 * queued, 900 already queued" is the honest answer, and hiding it would make the panel's
 * totals disagree with what was asked for.
 */
export async function enqueue(
  batchId: string,
  jobs: QueueEntry[],
  source: Source,
  lang: Lang = BASE_LANG,
): Promise<{ queued: number; skipped: number }> {
  if (jobs.length === 0) return { queued: 0, skipped: 0 };

  // Old batches are pruned here rather than on a schedule, because this is the only path
  // that grows the table and there is no cron on the droplet.
  await db().query(
    `delete from "regeneration_batch" where "createdAt" < now() - interval '${RETENTION}'`,
  );

  const { rowCount } = await db().query(
    `insert into "regeneration_job"
       ("batchId", "source", "lang", "lineId", "file", "npcName", "preview", "characters")
     select $1, $2, $8, * from unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::int[])
     on conflict ("source", "lang", "file") where "state" in ('pending', 'running') do nothing`,
    [
      batchId,
      source,
      jobs.map((job) => job.lineId),
      jobs.map((job) => job.file),
      jobs.map((job) => job.npcName),
      jobs.map((job) => job.preview),
      jobs.map((job) => job.characters),
      lang,
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
      returning j."id"::text, j."batchId", j."source", j."lang", j."lineId", j."file", j."npcName",
                j."preview", j."characters", j."attempts",
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

type JobAggregateRow = {
  pending: string;
  runningCount: string;
  done: string;
  failed: string;
  cancelled: string;
  credits: string;
  unpriced: string;
  running: { source: Source; lang: Lang; lineId: string; npcName: string; preview: string }[];
  failures: { source: Source; lang: Lang; lineId: string; message: string }[];
  finished: { id: string; source: Source; lang: Lang; lineId: string; file: string; version: number }[];
  cursor: string | null;
};

/**
 * The whole queue as the panel needs it.
 *
 * Scoped to the last day rather than to one batch: there is one ElevenLabs account and one
 * budget, so a batch someone else started is spending the same money and belongs on screen.
 *
 * One query against `regeneration_job` plus one against `regeneration_batch`, not seven: every
 * poll opens this many pooled connections, and with a leader and up to a dozen jobs already
 * holding their own, a poll that took one each was the tightest budget in the system. The job
 * query folds five aggregates and three ordered sub-lists into CTEs, with `json_agg` carrying
 * each list out as one column instead of one query per list - Postgres already builds those
 * lists in memory to answer the count, so asking it to hand them back costs nothing extra.
 */
/**
 * Wave away everything finished up to this job.
 *
 * Takes the id rather than reading the maximum itself, so what is dismissed is what the panel
 * was showing when the X was pressed. A job that finished in between stays news.
 */
export async function dismissThrough(jobId: string, userId: string | null): Promise<void> {
  await db().query(
    `insert into "queue_dismissal" ("id", "throughJobId", "dismissedBy")
     values (true, $1, $2)
     on conflict ("id") do update
        set "throughJobId" = greatest("queue_dismissal"."throughJobId", excluded."throughJobId"),
            "dismissedAt" = now(),
            "dismissedBy" = excluded."dismissedBy"`,
    [jobId, userId],
  );
}

export async function snapshot(since: string | null): Promise<QueueSnapshot> {
  // Live work first, then whatever finished recently: the two halves of what the panel is
  // for. Never just the age, for the reason WINDOW records.
  //
  // Terminal rows are also cut off at the dismissal watermark, which rides along as a CTE
  // rather than a second round trip: a poll costs two pooled queries and the test that pins
  // that is protecting the pool, not tidiness. Pending and running work is never cut off - a
  // queue still spending money must keep its panel and its Stop button, and dismissing
  // yesterday's run cannot be allowed to hide today's.
  const window =
    `("state" in ('pending', 'running') or ("queuedAt" > now() - interval '${WINDOW}' ` +
    `and "id" > (select through from dismissal)))`;

  const [job, latest] = await Promise.all([
    db().query<JobAggregateRow>(
      `with dismissal as (
         select coalesce((select "throughJobId" from "queue_dismissal" where "id"), 0) as through
       ),
       job_counts as (
         select
           count(*) filter (where "state" = 'pending')::text as pending,
           count(*) filter (where "state" = 'running')::text as "runningCount",
           count(*) filter (where "state" = 'done')::text as done,
           count(*) filter (where "state" = 'failed')::text as failed,
           count(*) filter (where "state" = 'cancelled')::text as cancelled,
           coalesce(sum("credits"), 0)::text as credits,
           count(*) filter (where "state" = 'done' and "credits" is null)::text as unpriced
         from "regeneration_job"
         where ${window}
       ),
       running_jobs as (
         select "source", "lang", "lineId", "npcName", "preview" from "regeneration_job"
          where "state" = 'running' order by "id" limit 20
       ),
       recent_failures as (
         select "source", "lang", "lineId", "error" as message from "regeneration_job"
          where "state" = 'failed' and ${window} order by "id" desc limit 20
       ),
       finished_page as (
         select "id"::text as "id", "source", "lang", "lineId", "file", "version" from "regeneration_job"
          where "state" = 'done' and "version" is not null
            and "id" > greatest(coalesce($1::bigint, 0), (select through from dismissal))
          order by "id" limit ${FINISHED_PAGE}
       ),
       terminal as (
         select max("id")::text as max from "regeneration_job"
          where "state" in ('done', 'failed') and "id" > (select through from dismissal)
       )
       select
         jc.*,
         coalesce((select json_agg(r) from running_jobs r), '[]') as running,
         coalesce((select json_agg(f) from recent_failures f), '[]') as failures,
         coalesce((select json_agg(p) from finished_page p), '[]') as finished,
         (select max from terminal) as cursor
       from job_counts jc`,
      [since],
    ),
    db().query<{ stoppedBecause: string | null; cancelled: string }>(
      `select b."stoppedBecause",
              (select count(*)::text from "regeneration_job" j
                where j."batchId" = b."id" and j."state" = 'cancelled') as cancelled
         from "regeneration_batch" b order by b."createdAt" desc limit 1`,
    ),
  ]);

  const row = job.rows[0];
  const finished = row.finished;

  return {
    active: Number(row.pending) + Number(row.runningCount) > 0,
    counts: {
      pending: Number(row.pending),
      running: Number(row.runningCount),
      done: Number(row.done),
      failed: Number(row.failed),
      cancelled: Number(row.cancelled),
    },
    credits: Number(row.credits),
    unpriced: Number(row.unpriced),
    running: row.running,
    failures: row.failures,
    latestBatch: latest.rows[0]
      ? {
          cancelled: Number(latest.rows[0].cancelled),
          stoppedBecause: latest.rows[0].stoppedBecause,
        }
      : null,
    finished,
    // Normally the high-water mark of *all* terminal jobs, not just the page returned, so a
    // cursor never sticks behind a job that failed rather than finished. But a full page
    // means there are more done jobs than fit, and taking the global maximum then would skip
    // every one after it - lines the page would never learn had been regenerated. A full page
    // therefore ends at its own last row, and the next poll picks up from there.
    cursor:
      finished.length === FINISHED_PAGE ? finished[finished.length - 1].id : (row.cursor ?? since ?? "0"),
  };
}
