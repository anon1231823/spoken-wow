-- How many rules we sent, and how many ElevenLabs kept.
--
-- Written because the absence of this cost a day. `case_sensitive: false` makes ElevenLabs
-- discard a PHONEME rule silently - no error, no warning, a 200 with an id and a version like
-- any other upload. Alias rules tolerate the same flag, so a lexicon of 134 phoneme entries
-- and 2 alias entries uploaded as 2 working rules and looked, from every surface this app
-- had, exactly like success.
--
-- Counting is the whole defence: send N, read the dictionary back, count the lexemes. A
-- mismatch is not something to reason about, it is something to display.
--
-- Nullable, because a row written before this migration recorded neither, and "unknown" is
-- the honest reading of those - not "all kept".
--
-- Additive and forward-only per deploy/bin/migrate.sh: the previous release ignores both.

alter table "pronunciation_lexicon" add column "rulesSent" integer;
alter table "pronunciation_lexicon" add column "rulesKept" integer;
