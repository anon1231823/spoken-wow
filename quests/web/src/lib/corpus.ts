/**
 * Reading the corpus: every voiceline the project knows how to produce.
 *
 * The corpus is written by Python (tts_cli/corpus.py) and committed. Everything here is
 * read-only - in particular `fileName` is computed by tts_cli/naming.py and never derived
 * on this side, because a filename that differs by one character addresses a file the
 * addon can never find, and it fails silently.
 */
import fs from "node:fs";
import zlib from "node:zlib";

import { CORPUS_PATH } from "./paths";

/** Mirrors the line schema built in tts_cli/corpus.py:build_corpus. */
export type CorpusLine = {
  lineId: string;
  source: "accept" | "progress" | "complete" | "gossip";
  questId: number | null;
  questTitle: string | null;
  npcId: number;
  npcName: string;
  npcType: "creature" | "gameobject" | "item";
  race: string;
  gender: string;
  voice: string;
  playerGender: "m" | "f" | null;
  text: string;
  originalText: string;
  fileName: string;
  generatable: boolean;
  skipReason: string | null;
};

export type Spawn = { map: number; x: number; y: number };

export type Corpus = {
  schemaVersion: number;
  generatedAt: string;
  lineCount: number;
  lines: CorpusLine[];
  spawns: Record<string, Spawn[]>;
};

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

export function readCorpus(corpusPath: string = CORPUS_PATH): Corpus {
  const gz = fs.readFileSync(corpusPath);
  return JSON.parse(zlib.gunzipSync(gz).toString("utf8")) as Corpus;
}

// Memoised on globalThis rather than in a module variable: the dev server re-evaluates
// modules on hot reload, and re-reading and re-parsing 2 MB on every request is felt.
const cacheKey = Symbol.for("wow-voiceover.corpus");
type CacheHolder = { [cacheKey]?: Corpus };

export function loadCorpus(): Corpus {
  const holder = globalThis as CacheHolder;
  if (!holder[cacheKey]) {
    holder[cacheKey] = readCorpus();
  }
  return holder[cacheKey]!;
}
