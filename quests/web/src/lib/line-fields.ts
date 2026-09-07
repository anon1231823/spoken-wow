/**
 * The closed sets a corpus line's source and entity type are drawn from.
 *
 * A module of their own, free of node imports, because the filter bar offers them as
 * dropdown options and a client component cannot reach into lib/search.ts or lib/corpus.ts
 * for them - those read the corpus off disk, and importing them would drag node:fs into the
 * browser bundle. Same reasoning as the note atop lib/generation/client.ts.
 *
 * Unlike race and voice (lib/facets.ts) these are not derived from the corpus: they are
 * decided by the extractor, and a value outside them means the corpus is malformed rather
 * than that the game has something new in it.
 */
export const SOURCES = ["accept", "progress", "complete", "gossip"] as const;
export const NPC_TYPES = ["creature", "gameobject", "item"] as const;

export type Source = (typeof SOURCES)[number];
export type NpcType = (typeof NPC_TYPES)[number];
