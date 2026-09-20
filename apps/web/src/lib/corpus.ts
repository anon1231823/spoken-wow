/**
 * What a voiceline is: the shape every reader of the quest corpus agrees on.
 *
 * TYPES AND PURE HELPERS ONLY. The rows themselves come from lib/quests/catalogue.ts now,
 * which reads quest_line the way the zones and books catalogues read theirs. This module
 * used to read and memoise corpus/corpus.json.gz; that file is an export of the table
 * these days, and the only things that still read it are the Python CLI and the addon
 * build, neither of which runs here.
 *
 * `fileName` is computed by tts_cli/naming.py and never derived on this side, because a
 * filename differing by one character addresses a file the addon can never find, and it
 * fails silently.
 */
import type { NpcType, Source } from "./line-fields";

/** Mirrors the line schema built in tts_cli/corpus.py:build_corpus. */
export type CorpusLine = {
  lineId: string;
  source: Source;
  questId: number | null;
  questTitle: string | null;
  npcId: number;
  npcName: string;
  npcType: NpcType;
  race: string;
  gender: string;
  /** Which of the race-gender's NPC voice sets, e.g. "shaman". Null where the game has none. */
  flavor: string | null;
  voice: string;
  playerGender: "m" | "f" | null;
  text: string;
  originalText: string;
  fileName: string;
  generatable: boolean;
  skipReason: string | null;
};

/**
 * The lines, and nothing else.
 *
 * The file this used to be read from also carries a schema version, an extraction
 * timestamp and a spawn table. None of them were ever read here -- they exist so the
 * addon build can be reproduced, and they live in quest_corpus_meta and quest_spawn now,
 * where the exporter reads them.
 */
export type Corpus = { lines: CorpusLine[] };

/**
 * Namespaced NPC key.
 *
 * Creature and gameobject IDs are separate spaces that overlap - creature 68 is a
 * Stormwind City Guard, gameobject 68 is a Wanted Poster - so grouping on the bare ID
 * merges unrelated entities. Same rule as spawn_key in tts_cli/corpus.py.
 */
export function npcKey(line: Pick<CorpusLine, "npcType" | "npcId">): string {
  return `${line.npcType}:${line.npcId}`;
}

/**
 * lineId -> every corpus line carrying it.
 *
 * Not one-to-one. A gossip lineId is `g:{md5(text + race + gender)}`, which says nothing
 * about who speaks it, so one id can belong to dozens of NPCs sharing a line - and they all
 * resolve to the same mp3. Anything that acts on a line rather than displaying it needs the
 * whole group: the text and the voice are identical across it, but the NPC is not.
 */
export function buildLineIndex(corpus: Corpus): Map<string, CorpusLine[]> {
  const index = new Map<string, CorpusLine[]>();
  for (const line of corpus.lines) {
    const group = index.get(line.lineId);
    if (group) group.push(line);
    else index.set(line.lineId, [line]);
  }
  return index;
}
