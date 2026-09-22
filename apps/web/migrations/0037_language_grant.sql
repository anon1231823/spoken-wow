-- Who may do what in which language, and ignores that belong to one language.
--
-- GRANTS. The global roles stay what they are: `admin` may do anything in every language,
-- and `collaborator` keeps exactly what it has always had, which is English -- editing text
-- and regenerating it. A grant adds a capability in one language on top of that, so a
-- Portuguese translator can write Portuguese without being able to regenerate English, and
-- nobody who holds a role today needs a row to keep doing what they do.
--
--   edit        write the language's text and names
--   regenerate  cut takes in it, spending one's own ElevenLabs credits
--   configure   its generation settings and lexicon
--   ignore      mark a line as never voiced in this language
--   admin       all of the above in this language, and granting edit and regenerate in it
create table "language_grant" (
  "userId"     text        not null references "user" ("id") on delete cascade,
  "lang"       text        not null check ("lang" ~ '^[a-z]{2}[A-Z]{2}$'),
  "capability" text        not null
    check ("capability" in ('edit', 'regenerate', 'configure', 'ignore', 'admin')),
  "grantedAt"  timestamptz not null default now(),
  -- SET NULL like every other provenance column here: the grant outlives who gave it.
  "grantedBy"  text        references "user" ("id") on delete set null,
  primary key ("userId", "lang", "capability")
);

create index "language_grant_lang_idx" on "language_grant" ("lang");

-- IGNORES AT TWO LEVELS. NULL is global -- a line nobody will ever voice in any language,
-- which is what every existing row is -- and a code is one language's decision, taken by
-- whoever looks after it. A line counts as ignored in a language if either kind names it.
--
-- The primary key on lineId stays for one release, for the reason 0035 widens its indexes in
-- two: the previous release upserts on ("lineId"). Until it goes, a line can carry only one
-- row, so a language cannot ignore a line that is already ignored everywhere -- which it has
-- no reason to -- nor two languages the same line.
alter table "line_ignore" add column "lang" text check ("lang" ~ '^[a-z]{2}[A-Z]{2}$');
create unique index "line_ignore_scope_idx" on "line_ignore" ("lineId", (coalesce("lang", '')));

-- The wider indexes 0035 added have been what the code conflicts on for a release now, so the
-- old ones can go -- and must, before the first non-English job or ack, which they would
-- refuse as a duplicate of the English one.
drop index "regeneration_job_one_per_file";
alter table "take_ack" drop constraint "take_ack_pkey";
