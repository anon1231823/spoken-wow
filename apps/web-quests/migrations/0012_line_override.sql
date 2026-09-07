-- What a line should say instead of what the corpus says it says.
--
-- Some findings no pronunciation rule can fix. q:1155:accept is the single letter "x".
-- q:257:complete says "adventurerama", because Blizzard wrote $Nama to mangle the player's
-- name and $N substitutes to a fixed word. Fifteen lines are raw binary. For these the only
-- fix is to rewrite what gets spoken, and this is where that rewrite lives.
--
-- WHY THIS IS SAFE. The audio filename and the addon's lookup keys derive from
-- original_text, never from the spoken text: filename_for_row (tts_cli/naming.py) uses
-- questId/source or md5(original_text + race + gender), and build.py keys every Lua table on
-- original_text. So rewriting what is spoken cannot rename a file or stop the addon finding
-- it. tests/test_naming.py proves it from the other side - its fixtures carry no text field
-- at all.
--
-- KEYED ON THE FILE, for the reason 0004 gives at length: 1,076 files are spoken by more
-- than one NPC, so a rewrite necessarily changes what all of them say. Keying on lineId
-- would let two rows disagree about one mp3. "lineId" is recorded beside it for provenance
-- and for the UI, the way voiceline_version records it - the corpus stays the authority.
--
-- ONE ROW, NOT A HISTORY. What was actually spoken for a given take is already recorded, as
-- voiceline_version."spokenHash" - a sha-256 of the exact string sent to ElevenLabs. That is
-- also what makes staleness answerable without another column: if today's text hashes
-- differently from the live take's, the audio predates the fix.
--
-- AN OVERRIDE RE-OPENS THE invalid-chars GATE. The corpus's "generatable" flag is computed
-- in Python from the pre-override text (tts_cli/corpus.py), so 99 lines holding $ or < > are
-- marked unvoiceable - the <cough> stage directions, the $2113w war-effort tallies.
-- Regeneration now checks the *effective* text instead, so stripping those characters makes
-- the line voiceable. Progress lines stay skipped: that is policy, not a text defect.
--
-- KNOWN DIVERGENCE. The Python CLI reads the corpus and will not see these rows, exactly as
-- it does not see the ElevenLabs pronunciation dictionary (web/src/lib/generation/tts.ts).
-- The web app is the generation path; this is recorded rather than solved.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the table is new, so the previous
-- release runs against this schema untouched.

create table "line_override" (
  -- Store-relative, e.g. 'quests/1155-accept.mp3'. The key voiceline_version uses.
  "file"      text        primary key,
  -- Provenance and the UI's way back to a row; not an identity.
  "lineId"    text        not null,
  "text"      text        not null,
  "updatedAt" timestamptz not null default now(),
  -- Nullable and SET NULL, matching every other table here: provenance outlives the account.
  "updatedBy" text        references "user" ("id") on delete set null
);
