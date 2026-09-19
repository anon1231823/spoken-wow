-- What the dictionary in force was built from, so "synced" stops being a guess about clocks.
--
-- The three sync states -- never uploaded, uploaded, saved-but-not-uploaded -- were derived
-- by comparing "syncedAt" against "updatedAt". Both are now(), which in Postgres is the
-- transaction's start time, and the save and the upload are two transactions microseconds
-- apart: they can land on the same instant. When they did, a re-upload that ElevenLabs had
-- refused reported itself as synced -- the editor showing entries that nothing is being
-- spoken with, which is the one lie this table exists to prevent. It surfaced as a test
-- failing about one run in three rather than as a bug report, because which way the tie
-- fell depended on the tick.
--
-- A digest of the entries the upload actually carried answers the question directly: what
-- is in force is in force because it was built from these rules, not because it happened
-- later. md5 of "entries"::text rather than a hash computed in the app, because jsonb's
-- text form is normalised by Postgres -- key order and whitespace cannot make two equal
-- lexicons disagree -- and the comparison then never leaves the database. Not a security
-- boundary; nothing here is adversarial, and a collision would only mis-report a state.
--
-- "syncedAt" stays. It is still what the editor shows as "last uploaded", and dropping a
-- timestamp because it was being asked the wrong question would lose the answer to the
-- right one.
--
-- Additive and forward-only per deploy/web/bin/migrate.sh: the column is nullable, so
-- the previous release runs against this schema untouched.

alter table "pronunciation_lexicon" add column "syncedDigest" text;

-- Backfill what the old comparison would have called synced, and nothing else. A row it
-- would have called pending stays null and still reads as pending; a row it got wrong
-- because of a tie is corrected here or on the next upload, which is the only direction
-- worth erring in -- claiming less than is in force costs one re-upload, claiming more
-- costs audio generated against rules nobody can see.
update "pronunciation_lexicon"
   set "syncedDigest" = md5("entries"::text)
 where "dictionaryId" is not null
   and "versionId" is not null
   and "syncedAt" is not null
   and "syncedAt" >= "updatedAt";
