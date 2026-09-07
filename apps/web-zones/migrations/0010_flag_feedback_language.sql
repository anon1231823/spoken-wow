-- A language dimension for what people say about a line.
--
-- Migrations 0008 and 0009 gave the corpus and its audio a language; the two
-- tables that record judgements about them were left as they were, keyed by line
-- alone. That was fine while every judgement was about English. It stops being
-- fine the moment somebody reads a German line: an editor marking it "bad" would
-- put the English line on the regeneration worklist, and a player's report about
-- German narration would badge the English line in the explorer, where the person
-- who can act on it would never connect it to the text it is about.
--
-- The column is added the same way as before -- back-filled to 'enUS', because
-- every existing row was written about the English text and audio -- and the
-- keys grow to include it: one flag per line PER LANGUAGE, and open feedback
-- counted per line per language. Nothing changes for English readers.
--
-- Feedback about the project (lineId null) also carries a language: which site
-- the reporter was on when they wrote it, which is worth knowing when the report
-- is "the German is wrong everywhere".
--
-- EVERY QUERY NAMES ITS LANGUAGE, as with lore_line. web/src/lib/catalogue.ts
-- loads flags and open counts for one language, and the APIs write into the one
-- the caller names.

alter table "line_flag" add column "lang" text not null default 'enUS';

alter table "line_flag" drop constraint "line_flag_pkey";
alter table "line_flag" add primary key ("lineId", "lang");

alter table "feedback" add column "lang" text not null default 'enUS';

drop index "feedback_open_line_idx";
create index "feedback_open_line_idx" on "feedback" ("lang", "lineId") where "status" = 'open';
