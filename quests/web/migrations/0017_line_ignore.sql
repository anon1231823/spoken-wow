-- Lines this project has decided never to voice.
--
-- Three kinds so far. The war-effort tallies read "$2113w", a world-state counter the game
-- expands against a live server: no committed corpus can hold the number, and a model asked
-- to read the token says "dollar twenty-one thirteen w". Blizzard's own debris is the
-- second - quest 1 is a test quest called 'The "Chow" Quest (123)aa'. The third is whatever
-- turns up next: a line no player can reach, a duplicate, a mistake.
--
-- NOT AN OVERRIDE AND NOT AN ISSUE. line_override rewrites what a line says; line_issue is
-- a scan's finding about text. This says the line should not exist as far as this project is
-- concerned - no audio, no queue entry, no lookup table row, and hidden in the explorer
-- unless asked for.
--
-- KEYED ON THE LINE, not the file, which is the opposite of line_override and 0004. Those
-- describe an mp3; this describes a line. 1,076 files are addressed by several lines, so a
-- dead line and a live one can share one file: keying on the file would let ignoring the
-- war-effort gossip disown audio another NPC still needs. Everything acting on files derives
-- them (tts_cli/ignores.py: a file is ignored only when its every line is).
--
-- REASON IS REQUIRED. The list is read by people months later deciding whether an entry
-- still holds. "Because it was broken" with no note is a decision nobody can revisit.
--
-- EXPORTED, NOT MIRRORED. `make pull-ignores` writes corpus/ignored.json for the Python CLI
-- and the rsync targets, which have no database. The export is a snapshot; this table is the
-- authority.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the table is new, so the previous
-- release runs against this schema untouched.

create table "line_ignore" (
  -- The corpus's own id, e.g. 'g:07d34a9ac2efe08e14fcc7808a928e9b' or 'q:1:accept'.
  "lineId"    text        primary key,
  -- Why, in a sentence. Shown on the row and carried into the export.
  "reason"    text        not null check (btrim("reason") <> ''),
  "createdAt" timestamptz not null default now(),
  -- Nullable and SET NULL, matching every other table here: provenance outlives the account.
  "createdBy" text        references "user" ("id") on delete set null
);

-- The 35 war-effort tallies and the test quest, seeded so the list starts where the decision
-- already is rather than needing 36 clicks. ON CONFLICT because a deploy re-running this
-- migration must not fail on rows an admin has since edited.
insert into "line_ignore" ("lineId", "reason") values
  ('g:07d34a9ac2efe08e14fcc7808a928e9b', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:1b0ce06896ec82f2b8d9de5f2bdfcecb', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:23e117cdf828f64a8f7832003c53ad13', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:263b5382493c8292898a68606c67c3c9', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:44b41addd3f8437df6055fc58b0a56d6', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:530a831c03043cceba408219672180c6', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:558293036bc20ba9ec357e7955395f89', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:5c6ee7053a94c92a28eaa92bf7f821d5', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:600752944f2ed7a5f2e5c2e398845f1c', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:698eb8f32440c4b3e71e2db100213268:f', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:698eb8f32440c4b3e71e2db100213268:m', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:6a21e863d9f49ec0041bd59ac1f3f839', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:6c50ab0ff636941be77f3f70ca2b8823', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:6fc4d0924029489ffd0a60e0ee958c21', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:80b3888d40c7eca0d3c8b8f9d61f3ac7', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:81234ee743d3102e90bf455d5a474ae2', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:8ca2008a454762fd014b24e00bac0365', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:8caa274c49387b4edd0ba33ed966f6b7', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:a262f229e20203f5b92f45814fe50213', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:a47ee7bcd6b3b8125ec6007fb1bbd6b9', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:ac1fc16d38645b54c1f8b2109349f841', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:c2a83d587c94ee4ec39e5ad2da461816', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:c87aec42c0c1d25bbb47559200796d1d', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:cb739c796aa3b55fa68a388c2a9df332', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:e5b3d0a093a4c464534cd95408b3c863:f', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:e5b3d0a093a4c464534cd95408b3c863:m', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:ed6188bded57a0cd48b72762e07b5202:f', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:ed6188bded57a0cd48b72762e07b5202:m', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:f66cbdf5f4c0994a74f1f4bca30e6850', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:f6c0c1ea475d9aa33d7c2f43bb8f2ba6', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('g:f7a0177f1d58938bf2f5b7ff9fe23301', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('q:8514:accept:f', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('q:8514:accept:m', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('q:8516:accept', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('q:8521:accept', 'war-effort tally: $NNNNw expands against a live server counter no corpus can hold'),
  ('q:1:accept', 'Blizzard test quest 1, unreachable in game')
on conflict ("lineId") do nothing;
