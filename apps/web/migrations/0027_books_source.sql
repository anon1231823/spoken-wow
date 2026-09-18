-- 'books' joins 'quests' and 'zones' as a source of takes and regeneration jobs.
--
-- 0024 wrote these check constraints with two values because there were two sides. The
-- third needs adding in both tables or a books take cannot be inserted at all -- and the
-- failure would appear at generation time, after the ElevenLabs call has been paid for.
--
-- The constraint names are the ones Postgres generated and this database reports; a
-- `drop constraint if exists` naming anything else would silently do nothing and leave the
-- old two-value constraint in place.
--
-- Additive and forward-only: the constraints only widen, so every row that was valid stays
-- valid and the previous release still runs against this schema.

alter table "take"
  drop constraint if exists "take_source_check",
  add constraint "take_source_check" check ("source" in ('quests', 'zones', 'books'));

alter table "regeneration_job"
  drop constraint if exists "regeneration_job_source_check",
  add constraint "regeneration_job_source_check" check ("source" in ('quests', 'zones', 'books'));
