-- Where each race-gender voice came from.
--
-- tts_cli/voices.py resolves voices by NAME at synthesis time and stays the runtime
-- authority; "voiceId" here is provenance, not resolution, so a value that drifts out of
-- date cannot break a generation run. What this table answers is "who made this voice, from
-- how much audio, and when" - questions nothing could answer before, which is why the
-- voices this project inherited could never be remade.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the table is new, so the previous
-- release runs against this schema untouched.

create table "voice_clone" (
  "voice"       text primary key,
  "voiceId"     text        not null,
  "clonedAt"    timestamptz not null default now(),
  -- Nullable, and SET NULL rather than CASCADE: provenance should outlive the account that
  -- created it. Deleting a user must not silently erase the record of where a shipped voice
  -- came from.
  "clonedBy"    text references "user" ("id") on delete set null,
  "sampleCount" integer     not null,
  "sampleBytes" bigint      not null,

  -- For voices donated by someone other than the operator. Unused while the roster is the
  -- twenty built in-house, and present from the start because specs/crowdsourced-npc-voices.md
  -- records that consent cannot be reconstructed after the fact: by the time a contributor
  -- asks for their voice to be removed, there is no way to learn which voice was theirs.
  "contributor"    text,
  "contributorUrl" text,
  "consentAt"      timestamptz,
  "consentNote"    text
);
