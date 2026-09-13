-- Which narrator read this take's stage directions, or null for an ordinary one.
--
-- Blizzard writes stage directions inside the NPC's quest text, and a take carrying one is made
-- by two voices: the NPC speaks, a narrator reads the bracketed part, and ElevenLabs returns a
-- single file. "voice" stays the NPC's, because history, the UI and the store all key on it and
-- the take is still that line's take.
--
-- A column rather than a speakers table: two is the shape the corpus actually has - 90 spans,
-- none of them a third party - and a general N-speaker provenance would be built for a case
-- that does not exist.
--
-- Null on every existing row, which is correct: they were all made by one voice.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the previous release neither writes nor
-- reads this column.

alter table "voiceline_version" add column "narratorVoice" text;
