-- What each take was pronounced with, so the app can say which audio has gone stale.
--
-- The problem this solves: filenames derive from a line's ORIGINAL text, deliberately, so a
-- pronunciation fix can be applied to audio that has already shipped without renaming
-- anything. The cost of that choice is that a shipped mp3 carries no evidence of the rules
-- that produced it, and after the first lexicon edit nothing can say which of the 9,456
-- files no longer match. These two columns are that evidence.
--
-- Two of them because pronunciation now arrives by two routes that go stale independently:
--
--   "spokenHash"         sha-256 of the exact text sent to ElevenLabs. Moves when the regex
--                        rules in voice/pronunciation.json change, or when the corpus text
--                        does. Text, not bytea: it is only ever compared for equality, and
--                        hex survives a psql session legibly.
--
--   "dictionaryVersion"  the ElevenLabs pronunciation-dictionary version in force. A phoneme
--                        rule changes how a word SOUNDS without changing a character of the
--                        text, so the hash above cannot see a lexicon edit at all.
--
-- Both nullable, and null means "unknown", not "unchanged": every row written before this
-- migration was made with pronunciation nobody recorded. Staleness must therefore be
-- reported as unknown for those rather than assumed either way - claiming 9,456 inherited
-- files are all current would be a lie, and claiming they are all stale would be useless.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the previous release ignores both.

alter table "voiceline_version" add column "spokenHash" text;
alter table "voiceline_version" add column "dictionaryVersion" text;
