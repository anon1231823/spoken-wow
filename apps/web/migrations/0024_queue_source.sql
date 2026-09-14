-- Which corpus a queued job belongs to.
--
-- One queue for both sections. The zones site ran its batches in process memory on
-- globalThis, which is why its pm2 config says `instances: 1` -- a second worker could not
-- see the first one's batch, so the site was capped at one process for a reason that had
-- nothing to do with serving pages. Those batches move onto these rows, and the cap goes.
--
-- The queue itself stays one queue, not two: there is one ElevenLabs plan behind it, the
-- panel shows what everyone is spending, and two queues would need a scheduler between them
-- to decide which is allowed to run. What the source decides is which generator a job is
-- handed to, and what its "file" means.
--
-- THE CREDIT GUARD GROWS THE SOURCE, which is the whole reason this migration is not just a
-- label. The index made a file unique among in-flight jobs, and the two sides name files by
-- different frozen rules -- quests files carry an extension and are shared by several NPCs,
-- zones files are extension-less and one per line. A collision would mean a zones job
-- silently blocking a quests one, which reads as "nothing happened when I pressed
-- Regenerate" with nothing anywhere saying why.
--
-- Default 'quests' on both tables so the existing rows are correct without a backfill: this
-- app's queue has only ever held quest work.
--
-- Additive and forward-only per deploy/quests/bin/migrate.sh. The index swap is the one
-- thing here that is not purely additive, and it is safe in both directions: the new index
-- is strictly weaker than the old one, so a previous release still enqueueing under the old
-- rule cannot violate it.

alter table "regeneration_batch"
  add column "source" text not null default 'quests'
  check ("source" in ('quests', 'zones'));

alter table "regeneration_job"
  add column "source" text not null default 'quests'
  check ("source" in ('quests', 'zones'));

drop index "regeneration_job_one_per_file";

create unique index "regeneration_job_one_per_file"
  on "regeneration_job" ("source", "file")
  where "state" in ('pending', 'running');
