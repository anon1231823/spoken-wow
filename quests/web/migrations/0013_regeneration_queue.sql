-- The work queue for mass regeneration.
--
-- Mass regeneration used to be a loop in the browser: Explorer.runBatch awaited
-- POST /api/regenerate once per line, and the progress, the credit total and the stop flag
-- lived in React state. That kept the server stateless, at the price written down in
-- src/app/api/regenerate/route.ts - closing the tab ended the batch, leaving the finished
-- lines on disk and the rest untouched, with nobody told which were which.
--
-- These rows are that loop, moved somewhere it can survive a closed tab, run several lines
-- at once, and be watched by someone who did not start it.
--
-- KEYED ON THE FILE, like voiceline_version and line_override, for the reason migration 0004
-- gives at length: 1,076 files in the corpus are spoken by more than one NPC, so a job is
-- one mp3 to generate rather than one line. "lineId" rides along for provenance and so the
-- progress panel can name what it is doing - the corpus stays the authority.
--
-- Additive and forward-only per deploy/bin/migrate.sh: both tables are new, so the previous
-- release runs against this schema untouched, which is what makes a rollback safe.

create table "regeneration_batch" (
  "id"             uuid        primary key default gen_random_uuid(),
  -- What the panel calls this batch, e.g. "every line this search matches".
  "label"          text        not null,
  "createdAt"      timestamptz not null default now(),
  -- Nullable and SET NULL, matching every other table here: provenance outlives the account.
  "createdBy"      text        references "user" ("id") on delete set null,
  "stoppedAt"      timestamptz,
  -- Why it gave up early: a fatal upstream failure, or someone pressing Stop.
  "stoppedBecause" text
);

create table "regeneration_job" (
  "id"         bigserial   primary key,
  "batchId"    uuid        not null references "regeneration_batch" ("id") on delete cascade,
  "lineId"     text        not null,
  -- Store-relative, e.g. 'quests/1155-accept.mp3'. The key the whole codebase uses.
  "file"       text        not null,
  -- Denormalised from the corpus so that polling every two seconds, and the worker itself,
  -- never need the 15 MB corpus index on their path.
  "npcName"    text        not null,
  "preview"    text        not null,
  "characters" integer     not null,
  -- Constrained, not just conventional: the claim index, the finished index and the credit
  -- guard below are all partial indexes predicated on "state in (...)" matching these exact
  -- strings, so a stray or misspelled state would fall outside every one of them - including
  -- the credit guard, which is the one that stops a file being paid for twice.
  "state"      text        not null default 'pending'
                 check ("state" in ('pending', 'running', 'done', 'failed', 'cancelled')),
  "attempts"   integer     not null default 0,
  -- When this job may next be claimed. Moved into the future to back off a rate limit.
  "notBefore"  timestamptz not null default now(),
  -- When the claim expires. Only ever consulted after a leader dies holding running rows.
  "leaseUntil" timestamptz,
  "version"    integer,
  "credits"    integer,
  "errorKind"  text,
  "error"      text,
  "queuedAt"   timestamptz not null default now(),
  "startedAt"  timestamptz,
  "finishedAt" timestamptz
);

-- The claim scan: pending work that is due, and running work whose lease has expired.
create index "regeneration_job_claim"
  on "regeneration_job" ("notBefore", "id")
  where "state" in ('pending', 'running');

-- The poll: everything that has finished since a cursor.
create index "regeneration_job_finished"
  on "regeneration_job" ("id")
  where "state" in ('done', 'failed');

-- THE CREDIT GUARD. A file may be queued at most once at a time, so running two overlapping
-- searches cannot pay ElevenLabs twice for the same mp3 and leave the second take live.
-- Enqueue is an ON CONFLICT DO NOTHING against this index. A job that reaches done, failed
-- or cancelled leaves the index, so the file can be queued again afterwards.
create unique index "regeneration_job_one_per_file"
  on "regeneration_job" ("file")
  where "state" in ('pending', 'running');
