-- A language dimension for the corpus.
--
-- The addon can now be read in a language other than English, so a line is no
-- longer one row's worth of text: it is one row per language, each with its own
-- history. What changes here is only the key -- "one current version per line"
-- becomes "one current version per line per language".
--
-- THE LANGUAGE IS A COLUMN, NOT PART OF "lineId". A lineId names a place, and it
-- is load-bearing well outside this table: ZoneLore:ReportURL builds
-- lore.rusty.one/r/{mapID}/{slug} from it, audio-history/ is laid out by it, and
-- links handed out by the Report button are already in players' hands. Prefixing
-- it with a locale would invalidate every one of those; a column back-fills to
-- 'enUS' and leaves them alone.
--
-- 'translated' is a fourth origin, and takes the same bargain as
-- 'scraped-rewritten': it may be recorded at any time, but it never promotes over
-- an 'edited' row. A re-translation must not be able to discard a correction
-- somebody made by hand, or re-translating becomes a command nobody dares run.
--
-- EVERY QUERY NAMES ITS LANGUAGE. Nothing in web/ or tools/ asks for "whatever is
-- current for this lineId" any more, because with two languages that question has
-- two answers: an unscoped read collides them, and an unscoped write clears the
-- other language's live flag and leaves it with no current version at all.
--
-- The explorer selects a language and writes into it (see README, "The explorer
-- has a language selector"). A first translation of a line is an insert rather
-- than an edit, taking its structure and its wiki "source" from the English row --
-- attribution follows a translation, which is a derivative work of the same
-- CC BY-SA text.

alter table "lore_line" add column "lang" text not null default 'enUS';

alter table "lore_line" drop constraint "lore_line_lineId_version_key";
alter table "lore_line" add constraint "lore_line_lineId_lang_version_key"
  unique ("lineId", "lang", "version");

drop index "lore_line_current_idx";
create unique index "lore_line_current_idx"
  on "lore_line" ("lineId", "lang") where "isCurrent";

drop index "lore_line_line_idx";
create index "lore_line_line_idx" on "lore_line" ("lineId", "lang", "version" desc);

alter table "lore_line" drop constraint "lore_line_origin_check";
alter table "lore_line" add constraint "lore_line_origin_check"
  check ("origin" in ('scraped', 'edited', 'scraped-rewritten', 'translated'));
