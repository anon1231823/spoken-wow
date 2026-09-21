-- A player's contribution, accepted, becomes a line in the quest tables -- not a table of its
-- own beside them. The tables are the corpus (0032); a line that lived anywhere else would be a
-- line the explorer, the history panel, the override and ignore flows and the export each had
-- to be taught about separately.
--
-- Two changes:
--
--   * quest_line gains a third origin. 'contributed' is the first version of a line a player
--     sent from their own client; an editor's fix on top of it is 'edited', like any other.
--
--   * quest_line_speaker gains "contributionId". The speaker row, not the line's origin, is
--     what marks a line as contributed: it survives an edit, it links back to the contribution
--     for the explorer's badge, and it is what the importer keeps. An import replaces every
--     speaker wholesale (tts_cli/corpus_db.py), and a row with a contributionId is not the
--     extract's to replace. Contributed rows take an `ord` from 1,000,000 up, clear of the
--     extract's own 0..n numbering, so they never collide with a re-import and the export lists
--     them after it.
--
-- No action on delete, deliberately: a contribution whose line is in the tables is not deleted
-- out from under it. Additive and forward-only.

alter table "quest_line" drop constraint "quest_line_origin_check";
alter table "quest_line" add constraint "quest_line_origin_check"
  check ("origin" in ('extracted', 'edited', 'contributed'));

alter table "quest_line_speaker"
  add column "contributionId" integer references "contribution" ("id");

create index "quest_line_speaker_contribution_idx"
  on "quest_line_speaker" ("contributionId") where "contributionId" is not null;
