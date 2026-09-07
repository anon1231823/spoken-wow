-- One ElevenLabs key per person, sealed.
--
-- The explorer used to spend from ELEVENLABS_API_KEY in the repo's .env, which meant
-- every editor spent the deployer's money and no row anywhere recorded whose click did
-- it. A key lives here instead, and the web app reads that variable no longer -- a user
-- without a key is refused before anything reaches ElevenLabs. tools/voice/*.mjs still
-- reads .env, because the CLI is run by one person on their own machine.
--
-- A table of its own rather than columns on "user": 0003_auth.sql is Better Auth's
-- generated output and its header says regeneration goes into a NEW file, so columns
-- added there by hand would be lost the next time the CLI runs.
--
-- "ciphertext"/"iv"/"tag" are base64 AES-256-GCM from web/src/lib/secrets.ts, under a
-- master key that is deployment configuration (ZONELORE_SECRET_KEY) and is not in this
-- database. "hint" is the last four characters, in the clear on purpose: it is what the
-- profile page shows to prove a key is set, and four characters authenticate nothing.
--
-- Primary key on "userId", so one key per person. There is one ElevenLabs account per
-- contributor here, and a key picker on every paid action would be a control for a
-- problem nobody has.

create table "elevenlabs_key" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "ciphertext" text not null,
  "iv" text not null,
  "tag" text not null,
  "hint" text not null,
  -- When ElevenLabs last confirmed the key, and what plan it answered with. Both come
  -- from the verification call made before the key is stored, so a row that exists is a
  -- key that worked at least once.
  "verifiedAt" timestamptz,
  "tier" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);
