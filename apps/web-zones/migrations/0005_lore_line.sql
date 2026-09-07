-- The lore corpus, with a history. What voiceline_take is to the audio, this is to
-- the words.
--
-- Until now the text was a build input rather than state: tools/scrape.mjs wrote
-- addon/ZoneLore/Data/*.lua from the wiki, and everything downstream read those files.
-- That made the text unimprovable from the explorer -- the one place where somebody is
-- actually reading the lines and noticing that one of them breaks the fourth wall --
-- and hand-editing was possible only for zones, through tools/seed/overrides.json.
-- Subzones, which are 1304 of the 1353 lines, had no supported edit path at all.
--
-- THE LUA FILES DO NOT GO AWAY. They are exported from here (tools/lore/export.mjs)
-- and stay committed, so the addon build, validate.mjs and package-audio.sh keep
-- working against files, and a clone with no Postgres can still ship the addon. This
-- is the same bargain migration 0001 struck for the manifest.
--
-- VERSIONED, AND FOR THE SAME REASON TAKES ARE. A re-scrape used to overwrite the file,
-- so a better sentence someone had written by hand was gone the moment the wiki was
-- read again. Here a scrape inserts a new version and only becomes live if nobody has
-- edited the line, which is what makes `node tools/scrape.mjs` cheap to run again.

create table "lore_line" (
  "id"        bigserial   primary key,
  -- 'z:1411' for a zone, 's:1411:razor hill' for a subzone. The same key
  -- voiceline_take uses; tools/voice/naming.mjs owns the format.
  "lineId"    text        not null,
  "version"   integer     not null,
  "isCurrent" boolean     not null default false,
  -- 'scraped' came from warcraft.wiki.gg, 'edited' was written by a person here.
  -- The distinction decides whether a later scrape may take the line back.
  "origin"    text        not null check ("origin" in ('scraped', 'edited')),

  -- The structural fields ride along because the Lua export has to reproduce them and
  -- this table is the only input to it. They are not editable through the app: which
  -- subzones exist is the scraper's business, not an editor's.
  "mapID"     integer     not null,
  "kind"      text        not null check ("kind" in ('zone', 'subzone')),
  -- The canonical subzone key, null for a zone line. See normaliseKey in
  -- tools/lib/wiki.mjs -- the client reports "The Bulwark" for a page titled "Bulwark".
  "key"       text,

  "name"      text        not null,
  "full"      text        not null,
  -- Derived from "full" by makeShort() unless somebody wrote one deliberately, which is
  -- what "shortIsManual" records. Without that flag an edit to "full" could not tell a
  -- hand-written summary from a stale derived one, and would have to either clobber the
  -- first or preserve the second forever.
  "short"     text        not null,
  "shortIsManual" boolean not null default false,

  -- The wiki page this text came from, and therefore its licence. Text derived from the
  -- wiki -- including an edit of it -- stays CC BY-SA 4.0 and keeps its source. Prose
  -- written from scratch has no source, and is the author's own; tools/seed/overrides.json
  -- has always drawn that line and the Lua export now draws it per entry rather than
  -- claiming CC BY-SA for a whole file.
  "source"    text,

  -- Who, and why. Null for scraped rows: no person wrote them.
  "editedBy"  text,
  "note"      text,

  "createdAt" timestamptz not null default now(),

  unique ("lineId", "version")
);

-- Exactly one live version per line, enforced rather than trusted, for the reason
-- voiceline_take_current_idx exists: two rows claiming to be current make the export
-- ambiguous, and the export is what the addon ships.
create unique index "lore_line_current_idx"
  on "lore_line" ("lineId") where "isCurrent";

-- The history panel's query, and the export's ordering.
create index "lore_line_line_idx" on "lore_line" ("lineId", "version" desc);
