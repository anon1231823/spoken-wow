-- The last two source constraints books was missing: batches, and reports.
--
-- 0027 widened "take" and "regeneration_job" because those are the two tables migration
-- 0024 had added a source column to. That was the wrong question to ask. The right one is
-- which tables carry a source check at all, and the answer is four: the two in 0024, plus
-- "regeneration_batch" -- which 0024 created already carrying one -- and "report", whose
-- own migration wrote its own.
--
-- The failure was invisible until a batch was queued rather than a single line: one page
-- regenerates through a route that writes only "take", so the whole books section looked
-- correct while the first "Regenerate these" click returned 500 with
-- `regeneration_batch_source_check`. A constraint that only one code path reaches is a
-- constraint only that code path tests.
--
-- Widened rather than dropped, and named explicitly: `drop constraint if exists` on a name
-- Postgres did not choose silently leaves the old constraint in place, and the widening
-- never happens. These four names are what this database reports.
--
-- Additive and forward-only: every row that was valid stays valid, and the release before
-- this one still runs against the schema.

alter table "regeneration_batch"
  drop constraint if exists "regeneration_batch_source_check",
  add constraint "regeneration_batch_source_check"
    check ("source" in ('quests', 'zones', 'books'));

alter table "report"
  drop constraint if exists "report_source_check",
  add constraint "report_source_check"
    check ("source" in ('quests', 'zones', 'books'));
