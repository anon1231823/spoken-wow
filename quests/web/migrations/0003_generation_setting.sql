-- The global generation settings: model, voice settings, seed strategy.
--
-- voice/generation.json remains what the Python CLI reads and what a fresh install starts
-- from; this table is the web app's override, so a setting can be changed without a deploy.
-- The two can therefore disagree, which is deliberate and documented in README.md: the web
-- app is now the driver, and the CLI is the path that still works without it.
--
-- One row, forever. Pinning the key to `true` is what makes that a constraint rather than a
-- convention - "insert ... on conflict (id) do update" cannot accidentally grow a second
-- configuration that half the workers would read.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the table is new, so the previous
-- release runs against this schema untouched.

create table "generation_setting" (
  "id"            boolean     primary key default true check ("id"),
  "modelId"       text        not null,
  "voiceSettings" jsonb       not null,
  "seedStrategy"  text        not null,
  "updatedAt"     timestamptz not null default now(),
  -- Nullable and SET NULL, matching voice_clone: who changed a setting should outlive the
  -- account, and deleting a user must not delete the settings themselves.
  "updatedBy"     text references "user" ("id") on delete set null
);
