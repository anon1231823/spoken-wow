-- The quest corpus, in the database, beside lore_line and book_line.
--
-- THIS REVERSES WHAT 0022 ARGUED, DELIBERATELY. That migration's header explains at length
-- that quest text is a committed file *because* it is extracted and only read, while zone
-- lore is a table because people write it. That was true when it was written and it is not
-- true now:
--
--   * The app has been the generation path since 0012. line_override already holds "what
--     this line should say instead", keyed by file, with no history and no way to see what
--     a line has been -- half a corpus in Postgres with none of a corpus's guarantees.
--   * line_ignore holds which lines are never voiced, and `make pull-ignores` exports it
--     back to a committed file so the CLI can read it. The database is already upstream;
--     the file is already a derivative.
--   * Two other corpora already do this, and every question that is easy about them --
--     what did this line say last week, who changed it, is this take made of the current
--     words -- is hard about quests, because the answer lives in a file nobody versions
--     per line.
--
-- What does NOT change is the promise requirements.txt makes: producing audio and building
-- a sound pack still need no database. The Python CLI keeps reading corpus/corpus.json.gz;
-- that file simply stops being hand-maintained and becomes an export, exactly as zones'
-- manifest.json did. tts_cli/corpus_db.py is the seam, and the check that it carries
-- everything is that an import followed by an export leaves the file byte-identical.
--
-- THREE TABLES, BECAUSE THE CORPUS HAS THREE GRAINS. lore_line and book_line are one row
-- per line. This corpus is one row per (line x speaker): 17,507 rows over 14,231 lineIds,
-- and within a single lineId the race varies on 43 of them, the flavor on 43 and the voice
-- on 45 -- one gossip line, many speakers, each with their own voice. A single lineId-keyed
-- table would quietly delete the explorer's NPC column and every race/gender facet with it.
--
-- Additive and forward-only per deploy/web/bin/migrate.sh: three new tables. line_override
-- and line_ignore are left in place, the way 0020 left voiceline_version -- the fold of
-- overrides into versions is a data step in the importer, not DDL, because it can only run
-- once quest_line is seeded and has to be safe to run twice.

create table "quest_line" (
  id          bigserial   primary key,

  -- 'q:33:accept', 'g:{md5}', with an optional ':m'/':f' for a player-gendered line.
  -- tts_cli/naming.py owns the format and nothing else derives it; AGENTS.md freezes it.
  "lineId"    text        not null,
  -- Which of the lines sharing that id this is.
  --
  -- 103 lineIds name two different texts -- q:172:accept is both an Ambassador Berrybuck
  -- line and a Children's Week orphanage line -- and both resolve to ONE filename, so only
  -- the first is ever voiced. That is a defect in the extract, and it is recorded here
  -- rather than smoothed away: collapsing them would change which of the two ships for 103
  -- files, quietly, as a side effect of a schema choice. The importer counts them and says
  -- so; fixing them is a decision somebody makes on purpose.
  "variant"   smallint    not null default 0,
  "lang"      text        not null default 'enUS',
  "version"   integer     not null,
  "isCurrent" boolean     not null default false,

  -- 'extracted' came out of the vmangos dump. 'edited' was written by a person here, and
  -- is what a line_override row becomes. The same two values book_line uses, for the same
  -- reason: a third that nothing writes is a promise somebody will read.
  "origin"    text        not null check ("origin" in ('extracted', 'edited')),

  -- Which event this line belongs to: accept, progress, complete, or gossip.
  "source"    text        not null,
  -- Null for gossip, which belongs to a speaker rather than to a quest.
  "questId"   integer,
  "questTitle" text,
  -- 'm' or 'f' where the game has a line per player gender, null otherwise.
  "playerGender" text check ("playerGender" in ('m', 'f')),

  -- Store-relative minus the extension, e.g. 'quests/5-accept'. COPIED FROM THE EXTRACT AND
  -- NEVER DERIVED HERE: the addon resolves a sound by looking its filename up in a table
  -- the pack ships, so a name differing by one character addresses a file that can never be
  -- found, and it fails silently. tts_cli/naming.py is the one place that builds these.
  "fileName"  text        not null,

  -- What is spoken, and what the game shipped. Both, because they answer different
  -- questions and an edit moves only the first: build.py keys every Lua lookup on the
  -- original text, and restoresOnlyNarration compares the two to tell a stage direction
  -- being put back from a real rewrite.
  "text"          text    not null,
  "originalText"  text    not null,

  -- Whether this line would be voiced at all, as tts_cli.corpus computed it, and why not.
  -- Kept and labelled rather than dropped, so the explorer can show that the game has a
  -- line and say why it is silent. book_line carries the same pair for the same reason.
  "generatable" boolean   not null default true,
  "skipReason"  text,

  -- Who, and why. Null for extracted rows: no person wrote them.
  "editedBy"  text,
  "note"      text,

  "createdAt" timestamptz not null default now(),

  unique ("lineId", "variant", "lang", "version")
);

-- Exactly one live version per line per language, enforced rather than trusted, for the
-- reason book_line_current_idx exists: two rows claiming to be current make the export
-- ambiguous, and the export is what the addon ships.
create unique index "quest_line_current_idx"
  on "quest_line" ("lineId", "variant", "lang") where "isCurrent";

-- The history panel's query, and the export's ordering.
create index "quest_line_line_idx"
  on "quest_line" ("lineId", "variant", "lang", "version" desc);

-- The take table is keyed on the file, because 1,192 of these files are spoken by more
-- than one NPC. Resolving a take back to its line goes through this.
create index "quest_line_file_idx" on "quest_line" ("fileName") where "isCurrent";


-- Who says a line, which is a fact about the world rather than a version of the words.
--
-- Unversioned and corrected in place on every import, including on lines somebody has
-- edited -- the rule pipelines/books/tools/lib/promote.mjs states for book structure and
-- 0026 states for page numbers. Which NPCs speak a line is the extractor's business; an
-- editor changes what is said, never who says it.
--
-- A table rather than an array on quest_line, unlike book_line."ownerIds": an owner there
-- is a single id, whereas a speaker here carries five fields that vary within one lineId,
-- and lib/facets.ts counts over every one of them. Seventeen thousand speaker objects in a
-- jsonb column is a corpus in a column, which is the thing this migration removes.
--
-- ONE ROW PER CORPUS ROW, IN THE CORPUS'S OWN ORDER, defects included. The extract is a
-- flat list and this transcribes it: 34 of its rows name a speaker that already appears
-- for the same line, 19 of those identically and 15 differing in the voice they claim. A
-- unique key over (line, speaker) would drop them, which sounds like tidying and is not --
-- the export is what the addon build reads, so anything dropped here changes what ships,
-- silently, for a reason nobody chose. They are counted and reported by the importer
-- instead. `ord` is the row's index in that list, and exists because the export has to
-- reproduce the file byte for byte; it is the one column here that is about the file
-- rather than about the world.
create table "quest_line_speaker" (
  id          bigserial   primary key,

  "lineId"    text        not null,
  "variant"   smallint    not null default 0,
  "lang"      text        not null default 'enUS',
  "ord"       integer     not null,

  -- Creature and gameobject ids are separate spaces that overlap -- creature 68 is a
  -- Stormwind City Guard, gameobject 68 is a Wanted Poster -- so the type is part of the
  -- identity and never dropped. Same rule as npcKey() and spawn_key().
  "npcType"   text        not null check ("npcType" in ('creature', 'gameobject', 'item')),
  "npcId"     integer     not null,
  "npcName"   text        not null,

  -- The voice slot, spelled race-gender-flavor. The flavor is which of a race and gender's
  -- two or three NPC voice sets this speaker uses, and is null where the game has none.
  "race"      text        not null,
  "gender"    text        not null,
  "flavor"    text,
  "voice"     text        not null,

  unique ("lang", "ord")
);

-- Resolving a line to its speakers, which is every search result.
create index "quest_line_speaker_line_idx" on "quest_line_speaker" ("lineId", "variant", "lang");

-- The facet counts group by these.
create index "quest_line_speaker_npc_idx" on "quest_line_speaker" ("npcType", "npcId");
create index "quest_line_speaker_voice_idx" on "quest_line_speaker" ("voice");


-- Where an NPC stands in the world.
--
-- Here so that the exported corpus can be reproduced exactly: tts_cli.corpus writes a
-- spawns table beside the lines and lines_in_area reads it, and a table that could not
-- reproduce it would not be carrying everything the addon build needs.
--
-- Keyed by the same namespaced pair as the speakers, and unversioned for the same reason:
-- a spawn point is a fact about the dump.
--
-- No unique key over the coordinates, for the reason the speakers have none over their
-- NPC: nine of the dump's spawn points are listed twice under the same key, and a
-- constraint that dropped them would make the export a tidied version of the file rather
-- than the file. Insertion order is the corpus's order, which is what the export reads
-- them back in.
create table "quest_spawn" (
  id          bigserial   primary key,

  "npcType"   text        not null check ("npcType" in ('creature', 'gameobject', 'item')),
  "npcId"     integer     not null,
  "map"       integer     not null,
  "x"         double precision not null,
  "y"         double precision not null
);

create index "quest_spawn_npc_idx" on "quest_spawn" ("npcType", "npcId");


-- What the extract said about itself: its schema version, and when it ran.
--
-- One row, like generation_setting. Kept because the export has to reproduce the file it
-- replaces, and `generatedAt` is a field of that file -- without it every export would
-- differ from the committed corpus in exactly one place, and the check that proves the
-- table carries everything would never pass.
create table "quest_corpus_meta" (
  "id"            boolean     primary key default true check ("id"),
  "schemaVersion" integer     not null,
  -- As the extract wrote it: an ISO-8601 string to the second, not a timestamptz, because
  -- what has to survive is the exact characters the file carries.
  "generatedAt"   text        not null,
  "importedAt"    timestamptz not null default now()
);
