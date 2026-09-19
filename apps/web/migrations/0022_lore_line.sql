-- The zones lore corpus, with a history. What "take" is to the audio, this is to the words.
--
-- Arriving whole from the zones site (its migrations 0005, 0006 and 0008 collapsed into
-- one, since this table has never existed here) because the merged site is where zone lore
-- is read and edited from now on. The rows themselves come across at cutover.
--
-- WHY THIS IS A TABLE AND THE QUESTS CORPUS IS A FILE. The two sides differ here and it is
-- not an inconsistency to tidy away later. Quest text is Blizzard's: it is extracted from
-- the game, nobody may rewrite what an NPC says, and the corpus is a build input that this
-- app only reads -- the one editable part is an override recorded beside it. Zone lore is
-- written: scraped from warcraft.wiki.gg, sometimes rewritten by a model, often corrected by
-- hand in the very page where somebody noticed the sentence was wrong. Text that people edit
-- needs a history and a live version; text that is extracted needs neither.
--
-- THE LUA FILES DO NOT GO AWAY. They are exported from here (pipelines/zones/tools/lore/
-- export.mjs) and stay committed, so the addon build, validate.mjs and package-audio.sh keep
-- working against files and a clone with no Postgres can still ship the addon.
--
-- VERSIONED FOR THE REASON TAKES ARE. A re-scrape used to overwrite the file, so a better
-- sentence somebody had written by hand was gone the moment the wiki was read again. Here a
-- scrape inserts a new version and only becomes live if nobody has edited the line, which is
-- what makes re-scraping cheap to run.
--
-- NO "source" COLUMN ON THE MERGE'S ACCOUNT: the one here is the wiki page the text came
-- from, and therefore its licence. Text derived from the wiki -- including an edit of it --
-- stays CC BY-SA 4.0 and keeps its source. Prose written from scratch has none and is the
-- author's own.
--
-- EVERY QUERY NAMES ITS LANGUAGE. With more than one, "whatever is current for this lineId"
-- has two answers: an unscoped read collides them, and an unscoped write clears the other
-- language's live flag and leaves it with no current version at all. The merged site serves
-- English only for now, and the column is here at full strength because the rows it is
-- importing already carry it.
--
-- Additive and forward-only per deploy/web/bin/migrate.sh: the table is new.

create table "lore_line" (
  "id"        bigserial   primary key,
  -- 'z:1411' for a zone, 's:1411:razor hill' for a subzone. The same key the take table
  -- uses; pipelines/zones/tools/voice/naming.mjs owns the format and nothing else derives it.
  "lineId"    text        not null,
  "lang"      text        not null default 'enUS',
  "version"   integer     not null,
  "isCurrent" boolean     not null default false,

  -- 'scraped' came from warcraft.wiki.gg. 'edited' was written by a person here.
  -- 'scraped-rewritten' was rewritten from the whole article by a model, which fixes what a
  -- lead-only scrape gets wrong and means the words are no longer words a human wrote on the
  -- wiki -- worth being able to ask about, so it is a value rather than a note.
  -- 'translated' is the same bargain: recordable at any time, never promoted over 'edited',
  -- because a re-translation that could discard a hand-made correction is a command nobody
  -- dares run.
  "origin"    text        not null
              check ("origin" in ('scraped', 'edited', 'scraped-rewritten', 'translated')),

  -- The structural fields ride along because the Lua export has to reproduce them and this
  -- table is its only input. They are not editable through the app: which subzones exist is
  -- the scraper's business, not an editor's.
  "mapID"     integer     not null,
  "kind"      text        not null check ("kind" in ('zone', 'subzone')),
  -- The canonical subzone key, null for a zone line. See normaliseKey in tools/lib/wiki.mjs:
  -- the client reports "The Bulwark" for a page titled "Bulwark".
  "key"       text,

  "name"      text        not null,
  "full"      text        not null,
  -- Derived from "full" by makeShort() unless somebody wrote one deliberately, which is what
  -- "shortIsManual" records. Without that flag an edit to "full" could not tell a
  -- hand-written summary from a stale derived one, and would have to either clobber the
  -- first or preserve the second forever.
  "short"         text    not null,
  "shortIsManual" boolean not null default false,

  "source"    text,

  -- Who, and why. Null for scraped rows: no person wrote them. Text rather than a reference
  -- to "user", as it arrives: the rows being imported carry names from a site whose accounts
  -- are being merged by email, and turning a name into a foreign key would either invent a
  -- match or drop the attribution.
  "editedBy"  text,
  "note"      text,

  "createdAt" timestamptz not null default now(),

  unique ("lineId", "lang", "version")
);

-- Exactly one live version per line per language, enforced rather than trusted, for the
-- reason take_current_idx exists: two rows claiming to be current make the export ambiguous,
-- and the export is what the addon ships.
create unique index "lore_line_current_idx"
  on "lore_line" ("lineId", "lang") where "isCurrent";

-- The history panel's query, and the export's ordering.
create index "lore_line_line_idx" on "lore_line" ("lineId", "lang", "version" desc);
