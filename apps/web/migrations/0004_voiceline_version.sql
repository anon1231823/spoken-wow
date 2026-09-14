-- Every take of a voiceline this app has written, and which one is live.
--
-- Keyed on the store-relative FILE, not on a lineId or an NPC. 1,076 files in the corpus are
-- spoken by more than one NPC, because a gossip file is named md5(text + race + gender) and
-- says nothing about who says it - so "regenerate this line" is really "replace this file",
-- and everyone sharing it hears the change.
--
-- The bytes live on disk under audio-history/; this is the record of what they are. Version 0
-- is whatever was in the store before this app first touched the file, archived at that
-- moment, which is the only reason the audio the project inherited is recoverable at all.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the table is new, so the previous
-- release runs against this schema untouched.

create table "voiceline_version" (
  "id"         bigserial   primary key,
  "file"       text        not null,          -- store-relative, e.g. 'gossip/31ab….mp3'
  "version"    integer     not null,
  "isCurrent"  boolean     not null default false,
  -- 'inherited' is version 0: audio that predates this app, whose settings are unknowable.
  -- 'generated' is everything this app made, and carries what it was made with.
  "origin"     text        not null check ("origin" in ('inherited', 'generated')),

  -- Which line this file belongs to. Recorded for provenance and for the UI; the corpus
  -- stays the authority, so a lineId that drifts out of the corpus cannot break playback.
  "lineId"     text        not null,
  "voice"      text        not null,

  "voiceId"    text,
  "modelId"    text,
  "seed"       bigint,
  "characters" integer,
  "bytes"      bigint      not null,
  -- The voice_settings sent to ElevenLabs, so a take that sounds right can be reproduced
  -- after the global settings have moved on.
  "settings"   jsonb,

  "createdAt"  timestamptz not null default now(),
  -- Nullable and SET NULL, matching voice_clone: provenance outlives the account.
  "createdBy"  text references "user" ("id") on delete set null,

  unique ("file", "version")
);

-- Exactly one live version per file, enforced rather than trusted: two rows claiming to be
-- current would make the history UI show a restore that never happened.
create unique index "voiceline_version_current_idx"
  on "voiceline_version" ("file") where "isCurrent";

-- The history panel's only query.
create index "voiceline_version_file_idx" on "voiceline_version" ("file", "version" desc);
