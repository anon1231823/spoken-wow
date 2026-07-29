-- The pronunciation lexicon the web app generates with, and the dictionary it became.
--
-- SUPERSEDED IN PART BY 0008. The two-layer arrangement described below - a committed file as
-- the default, this row as the override - did not survive contact with the fact that a
-- lexicon is edited from the web UI. 0008 seeds this row and the file is gone; the table
-- itself is unchanged. Read 0008's header for why.
--
-- The same two-layer arrangement as generation_setting, for the same reason: voice/lexicon.json
-- ships in the release and is what a fresh install starts from, and this row - when it exists -
-- is what the web app uses. Absent means the committed file is in force, which is a state the
-- editor can report honestly instead of showing values that merely happen to match.
--
-- One row, forever, pinned the way generation_setting pins it. "insert ... on conflict (id) do
-- update" cannot then grow a second lexicon that half the workers would read.
--
-- entries is the WHOLE lexicon, not a set of overrides. Per-entry overrides would need a merge
-- against a file that moves under them at every deploy, and "which of these 134 came from
-- where" is a question nobody editing a mispronounced name wants to answer. The editor sends
-- every entry on every save, matching validateConfig's whole-object semantics.
--
-- dictionaryId and versionId are what ElevenLabs gave back for these entries. They are stored
-- next to the entries, in the same row, on purpose: a locator that does not correspond to the
-- entries beside it is worse than no locator, because generation would then apply
-- pronunciations nobody can read on this page. syncedAt being older than updatedAt is the
-- honest signal that a save reached Postgres but not ElevenLabs.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the table is new, so the previous
-- release runs against this schema untouched.

create table "pronunciation_lexicon" (
  "id"           boolean     primary key default true check ("id"),
  "entries"      jsonb       not null,
  -- Null until a sync succeeds. A lexicon that Postgres has and ElevenLabs does not is a
  -- legitimate intermediate state - the save is not lost, it is merely not yet in effect.
  "dictionaryId" text,
  "versionId"    text,
  "syncedAt"     timestamptz,
  "updatedAt"    timestamptz not null default now(),
  -- Nullable and SET NULL, matching generation_setting: who changed a pronunciation should
  -- outlive the account, and deleting a user must not delete the lexicon.
  "updatedBy"    text references "user" ("id") on delete set null
);
