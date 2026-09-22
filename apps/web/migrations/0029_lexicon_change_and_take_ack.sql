-- Audio that predates a pronunciation change, and the mark somebody cleared by hand.
--
-- A lexicon edit changes how a name SOUNDS without changing a character of the text it
-- appears in. Every staleness check this project has is a text comparison -- "spokenHash"
-- on the quests side, "textHash" on zones and books -- so none of them can see one. 0006
-- wrote "dictionaryVersion" on every take for exactly this question and nothing ever read
-- it: an admin fixes Tauren, the dictionary uploads, and the files that say the word keep
-- saying it the old way with nothing recording that they are now wrong.
--
-- CLEARED BY HAND, NEVER BY THE APP. Regenerating a take costs characters, a phoneme edit
-- does not always warrant one, and "this one is fine as it is" is a judgement that has
-- nowhere to live today. A regeneration still clears it for free, because a new take
-- postdates the change -- nothing has to remember to un-mark anything.

-- One row per grapheme per save that altered it, written by diffing the stored entries
-- against the incoming ones. LOGGED AT SAVE, NOT AT SYNC: the save is the human act, and
-- it is what a take's timestamp has to be compared against. "versionId" is unknown until
-- ElevenLabs answers and is recorded for provenance only.
--
-- A removal is logged like an edit. Dropping a rule changes how the word sounds just as
-- much as adding one, and a take made while the rule stood no longer matches what would be
-- spoken today.
create table "lexicon_change" (
  "id"        bigserial   primary key,
  "grapheme"  text        not null,
  "kind"      text        not null check ("kind" in ('added', 'edited', 'removed')),
  -- The sync that carried this change, when one succeeded. Null for a save whose upload
  -- failed, which is a real state (see 0019) and not one to hide: the change happened.
  "versionId" text,
  "changedAt" timestamptz not null default now(),
  -- Nullable and SET NULL, matching the lexicon itself: who fixed a pronunciation should
  -- outlive the account.
  "changedBy" text references "user" ("id") on delete set null
);

-- The sweep asks "what changed since this take", which is this index read backwards.
create index "lexicon_change_at_idx" on "lexicon_change" ("changedAt" desc);

-- The mark, cleared.
--
-- KEYED ON THE FILE, NOT THE LINE, which is 0004's choice for 0004's reason: 1,076 quests
-- files are addressed by several lines, and what is dirty is the recording. Acking per line
-- would leave a file marked dirty through one NPC after being cleared through another.
--
-- ONE ROW, NOT A HISTORY, like line_flag: what matters is whether the audio as it stands
-- has been judged, and by when. A TIMESTAMP RATHER THAN A BOOLEAN is what makes a second
-- edit to the same word re-dirty a take somebody already cleared -- they judged it against
-- the rules as they stood, and the rules moved again.
create table "take_ack" (
  "source"  text        not null check ("source" in ('quests', 'zones', 'books')),
  "file"    text        not null,
  "ackedAt" timestamptz not null default now(),
  "ackedBy" text references "user" ("id") on delete set null,
  primary key ("source", "file")
);
