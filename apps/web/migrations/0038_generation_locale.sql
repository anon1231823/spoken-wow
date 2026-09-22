-- How each language other than English is generated, and the pronunciations it is spoken with.
--
-- English keeps the two singleton rows it has always had, untouched: the release before this
-- one reads them by `where "id"`, and English generation must not move while another language
-- starts. Every other language gets a row here, keyed by its code, once somebody with
-- `configure` in it saves one.
--
-- A language with no settings row generates with English's model and voice settings but none
-- of its accent tags: "[Scottish accent]" on a dwarf is a direction about English, and would
-- be a strange thing to hear in Portuguese. lib/generation/settings.ts says which is in force.
create table "generation_setting_locale" (
  "lang"          text        primary key check ("lang" ~ '^[a-z]{2}[A-Z]{2}$' and "lang" <> 'enUS'),
  "modelId"       text        not null,
  "voiceSettings" jsonb       not null,
  "seedStrategy"  text        not null,
  "raceTags"      jsonb       not null default '{}',
  "updatedAt"     timestamptz not null default now(),
  "updatedBy"     text references "user" ("id") on delete set null
);

-- One ElevenLabs dictionary per language, since a phoneme means different things under
-- different phonologies and a rule written for English would be wrong read as German. The
-- columns are pronunciation_lexicon's, with the same meaning; the dictionary is created on the
-- language's first save and updated in place after, its id held here rather than in an
-- environment variable, which is English's.
create table "pronunciation_lexicon_locale" (
  "lang"         text        primary key check ("lang" ~ '^[a-z]{2}[A-Z]{2}$' and "lang" <> 'enUS'),
  "entries"      jsonb       not null default '[]',
  "dictionaryId" text,
  "versionId"    text,
  "rulesSent"    integer,
  "rulesKept"    integer,
  "syncedDigest" text,
  "syncedAt"     timestamptz,
  "updatedAt"    timestamptz not null default now(),
  "updatedBy"    text references "user" ("id") on delete set null
);

-- The last of the keys 0035 and 0037 widened: the release before this one upserts ignores on
-- the scope index, so the old one-row-per-line key can go, and a language may now ignore a
-- line that is ignored somewhere else too.
alter table "line_ignore" drop constraint "line_ignore_pkey";
