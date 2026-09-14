-- Every take of every voiceline, from both sides of the site.
--
-- The quests explorer had "voiceline_version" and the zones one had "voiceline_take". They
-- are the same table written twice: a row per generated take, a partial unique index naming
-- the live one, a settings blob so a take that sounded right can be reproduced, and a
-- history panel reading the versions of one file newest first. Merging the sites means one
-- history panel, one restore path and one queue writing takes, so it means one table.
--
-- "source" IS PART OF EVERY KEY, not merely a label. The two sides name files by different
-- rules that AGENTS.md freezes in place: quests files carry an extension and are shared by
-- more than one NPC ('gossip/31ab….mp3'), zones files are extension-less and are one per
-- line ('1411/razor-hill'). Nothing guarantees the two namespaces stay disjoint, and a
-- collision would silently make one side's take the current version of the other side's
-- file. With "source" in the unique keys it cannot happen, and neither pipeline has to know
-- the other exists.
--
-- KEYED ON "file", WHICH IS THE HONEST KEY ON BOTH SIDES. Quests keys on the file because
-- 1,076 of its files are spoken by several NPCs -- a gossip file is named
-- md5(text + race + gender) and says nothing about who says it -- so "regenerate this line"
-- is really "replace this file". Zones keyed on the lineId instead, which it could, because
-- naming.mjs gives every line a file of its own and disambiguates a slug collision by hash.
-- One file per line is a special case of one row per file, so the file key holds for both;
-- the reverse would not. "lineId" rides along, indexed, because it is how the zones side
-- looks a take up.
--
-- The union of the two column sets, with the differences reconciled as nullable rather than
-- defaulted: a zones take genuinely has no "voice" (its narrator is the one voice, recorded
-- in "voiceId"), a quests take genuinely has no "durationSec", and writing a placeholder
-- would turn "this side does not record that" into a value somebody could read.
--
-- Names come from the quests side where they differed, because more of this app's code
-- already speaks them: "chars" becomes "characters", "textHash" becomes "spokenHash",
-- "dictionaryVersionId" becomes "dictionaryVersion", "generatedAt" becomes "createdAt".
--
-- "voiceline_version" is left in place. It is the rollback: the copy below is one statement
-- and this schema has to be right before the old table can go, which it does in the cleanup
-- after the cutover has held.
--
-- Additive and forward-only per deploy/quests/bin/migrate.sh: the table is new.

create table "take" (
  "id"        bigserial   primary key,

  -- Which side of the site this take belongs to. Part of every key below.
  "source"    text        not null check ("source" in ('quests', 'zones')),
  -- Which language it was narrated in. Only the zones corpus has more than one, and only
  -- 'enUS' has ever been generated; the column exists so that recording the rest is
  -- possible, and so the keys are already the right shape when it happens.
  "lang"      text        not null default 'enUS',

  -- Store-relative. Quests: 'gossip/31ab….mp3'. Zones: '1411/razor-hill', extension-less,
  -- because the addon appends it. Both frozen by AGENTS.md.
  "file"      text        not null,
  -- 'q:33:accept', 'g:{md5}', 'z:1411', 's:1411:razor hill'. Recorded for provenance and
  -- for the UI; no foreign key, because on both sides a line is derived from a file on disk
  -- rather than a row, and a lineId that stops resolving is a fact worth keeping.
  "lineId"    text        not null,

  "version"   integer     not null,
  "isCurrent" boolean     not null default false,
  -- 'inherited' is the quests side's version 0 and 'imported' the zones side's version 1:
  -- both mean audio that predates the app that would have recorded how it was made. Kept as
  -- two values rather than folded into one, because each side's history already says which
  -- of them it wrote and rewriting that would be inventing provenance.
  "origin"    text        not null
              check ("origin" in ('inherited', 'imported', 'generated')),

  -- The NPC voice, as 'race-gender-flavor'. Null on the zones side, where every line is
  -- read by the narrator and there is no roster row to name.
  "voice"         text,
  -- Which narrator read this take's stage directions, or null for an ordinary one. The
  -- quests side puts an NPC in "voice" and the narrator here; a merged zones take could
  -- reasonably do the reverse, and does not, so that "voice" always means "the NPC".
  "narratorVoice" text,

  "voiceId"      text,
  "modelId"      text,
  "seed"         bigint,
  "outputFormat" text,
  -- The voice_settings sent to ElevenLabs, so a take that sounds right can be reproduced
  -- after the global settings have moved on. Null for inherited and imported takes.
  "settings"     jsonb,

  -- Characters sent, and what ElevenLabs actually charged for them. Not the same number:
  -- billing is round(characters * rate) and the rate belongs to the plan, not the request.
  -- "credits" is nullable because the character-cost header is not guaranteed, and an
  -- unpriced take is honestly unpriced rather than priced by guesswork.
  "characters"  integer,
  "credits"     integer,
  "durationSec" numeric,
  "bytes"       bigint      not null,

  -- What this take was pronounced with, so the app can say which audio has gone stale.
  -- "spokenHash" moves when the regex rules or the text move; "dictionaryVersion" catches a
  -- phoneme rule, which changes how a word sounds without changing a character of the text.
  -- Null means unknown, not unchanged.
  "spokenHash"        text,
  "dictionaryId"      text,
  "dictionaryVersion" text,

  "createdAt" timestamptz not null default now(),
  -- Nullable and SET NULL: provenance outlives the account that made it.
  "createdBy" text references "user" ("id") on delete set null,

  unique ("source", "lang", "file", "version")
);

-- Exactly one live take per file per language per side, enforced rather than trusted: two
-- rows claiming to be current would make the history UI show a restore that never happened,
-- and on the zones side would make the manifest export ambiguous -- and the export is what
-- the addon ships.
create unique index "take_current_idx"
  on "take" ("source", "lang", "file") where "isCurrent";

-- The history panel's query, on either side.
create index "take_file_idx" on "take" ("source", "lang", "file", "version" desc);

-- The zones side looks a take up by line rather than by file. One file per line there, so
-- this is a second route to the same row rather than a different set.
create index "take_line_idx" on "take" ("source", "lang", "lineId", "version" desc);

-- The calibration query reads recent generated takes for one model. Across both sides on
-- purpose: the rate being calibrated is the plan's, and which corpus was narrated to
-- measure it does not change what the next line will cost.
create index "take_credits_idx"
  on "take" ("modelId", "createdAt" desc) where "credits" is not null;

-- Every quests take, unchanged but for the two names and the two new keys. Ids are not
-- preserved: nothing references a take by id -- the queue records a version number, the
-- history panel asks by file -- and letting the sequence assign them keeps it correct for
-- the zones rows that arrive at cutover.
insert into "take" (
  "source", "lang", "file", "lineId", "version", "isCurrent", "origin",
  "voice", "narratorVoice", "voiceId", "modelId", "seed", "settings",
  "characters", "credits", "bytes", "spokenHash", "dictionaryVersion",
  "createdAt", "createdBy"
)
select
  'quests', 'enUS', "file", "lineId", "version", "isCurrent", "origin",
  "voice", "narratorVoice", "voiceId", "modelId", "seed", "settings",
  "characters", "credits", "bytes", "spokenHash", "dictionaryVersion",
  "createdAt", "createdBy"
from "voiceline_version"
order by "id";
