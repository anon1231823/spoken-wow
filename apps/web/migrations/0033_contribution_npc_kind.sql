-- The kind a moderator chose for a contribution whose envelope never said what its NPC is.
--
-- The addon's earliest envelopes name an NPC by id alone, and an id can exist as both a
-- creature and a gameobject. When the answers on file for the two disagree, the moderator picks
-- which one this contribution meant, and that pick lives here -- on the contribution, not in
-- `meta`, which stays exactly what the player's client sent. Every reader (the triage page,
-- accept, the export) treats a row with this set as if its envelope had carried `kind`.
--
-- Null for every row whose envelope carried its own kind, and for kind-less rows nobody has
-- chosen for. Additive and forward-only.

alter table "contribution"
  add column if not exists "npcKind" text
  constraint contribution_npc_kind_check check ("npcKind" in ('creature', 'gameobject'));
