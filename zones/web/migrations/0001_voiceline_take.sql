-- Every take of every voiceline this project has made, and which one is live.
--
-- This is tools/voice/manifest.json with a history. The manifest records one row per
-- line -- what exists right now -- and that is enough to build the addon's lookup
-- table but not enough to undo a bad re-roll. A take that cost real money and sounded
-- right is unrecoverable the moment a second one overwrites the file, and re-rolling
-- is the whole point of the explorer this table exists for.
--
-- The manifest does not go away. It is exported from here (tools/voice/export-manifest.mjs)
-- and stays committed, so build-lookup.mjs, validate-audio.mjs and package-audio.sh
-- keep working against a file and a clone with no Postgres can still ship the addon.
--
-- KEYED ON lineId, NOT ON file. ../wow-voiceover keys its equivalent table on the file
-- because 1,076 of its files are spoken by more than one NPC -- a gossip file is named
-- md5(text + race + gender) and says nothing about who says it -- so "regenerate this
-- line" is really "replace this file". Here tools/voice/naming.mjs assigns one file per
-- line and disambiguates a slug collision by hash, so no two lines can ever share an
-- mp3 and lineId is the honest key. "file" rides along because it is what the addon
-- lookup and the path on disk use.
--
-- The bytes of superseded takes live under audio-history/; this is the record of what
-- they are. Version 1 is 'imported': everything the manifest already recorded before
-- this table existed, whose voice settings are unknowable because the manifest never
-- stored them. That is the only reason the ~1353 lines generated before this app is
-- built are recoverable at all rather than a floor to overwrite.

create table "voiceline_take" (
  "id"           bigserial   primary key,
  -- 'z:1411' for a zone, 's:1411:razor hill' for a subzone. tools/voice/naming.mjs
  -- owns this format and nothing else derives it.
  "lineId"       text        not null,
  -- Store-relative and extension-less, e.g. '1411/razor-hill'. The addon appends
  -- ".mp3"; the lookup table stores it exactly this way.
  "file"         text        not null,
  "version"      integer     not null,
  "isCurrent"    boolean     not null default false,
  "origin"       text        not null check ("origin" in ('imported', 'generated')),

  -- sha1 of the SPOKEN text, not the display text, so a pronunciation rule change
  -- correctly marks the lines it affects stale. See tools/voice/naming.mjs.
  "textHash"     text        not null,
  "chars"        integer     not null,
  -- What ElevenLabs actually charged, from the character-cost response header. Null
  -- when it did not say -- which is not the same as zero, and is why this is nullable
  -- rather than defaulted.
  "credits"      integer,
  "durationSec"  numeric,
  "bytes"        bigint      not null,

  "voiceId"      text,
  "modelId"      text,
  "outputFormat" text,
  -- Recorded so a pronunciation change can be told apart from a text change after the
  -- fact: re-resolving a dictionary does not move textHash.
  "dictionaryId" text,
  "dictionaryVersionId" text,
  -- The voice_settings sent, so a take that sounds right can be reproduced after the
  -- global settings in config.json have moved on. Null for imported takes.
  "settings"     jsonb,

  "generatedAt"  timestamptz not null default now(),

  unique ("lineId", "version")
);

-- Exactly one live take per line, enforced rather than trusted: two rows claiming to
-- be current would make the export ambiguous, and the export is what the addon ships.
create unique index "voiceline_take_current_idx"
  on "voiceline_take" ("lineId") where "isCurrent";

-- The history panel's only query.
create index "voiceline_take_line_idx" on "voiceline_take" ("lineId", "version" desc);
