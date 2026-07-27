/**
 * Locating a line's audio in the store (audio/{quests,gossip}/*.mp3).
 *
 * `fileName` comes from the corpus, computed by Python. The only naming decision made on
 * this side is which subdirectory a line lives in, and it lives here alone - it is the
 * TypeScript twin of subfolder_from_line_id in tts_cli/naming.py. audio.test.ts pins the
 * two together by asserting every file in the store is addressed by some corpus line.
 */
import fs from "node:fs";
import path from "node:path";

import type { CorpusLine } from "./corpus";
import { AUDIO_DIR } from "./paths";

export const SUBFOLDERS = ["quests", "gossip"] as const;

export function subfolder(line: Pick<CorpusLine, "source">): "quests" | "gossip" {
  return line.source === "gossip" ? "gossip" : "quests";
}

/** Store-relative path, e.g. "quests/5-accept.mp3". Also the /api/audio/ route path. */
export function audioRelPath(line: Pick<CorpusLine, "source" | "fileName">): string {
  return `${subfolder(line)}/${line.fileName}.mp3`;
}

export function readStoreIndex(audioDir: string = AUDIO_DIR): Set<string> {
  const found = new Set<string>();
  for (const sub of SUBFOLDERS) {
    const dir = path.join(audioDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".mp3")) found.add(`${sub}/${name}`);
    }
  }
  return found;
}

// One readdir of the two directories, memoised, instead of a stat per line: a search
// hitting 2,000 lines would otherwise make 2,000 syscalls.
const cacheKey = Symbol.for("wow-voiceover.store");
type CacheHolder = { [cacheKey]?: Set<string> };

export function storeIndex(): Set<string> {
  const holder = globalThis as CacheHolder;
  if (!holder[cacheKey]) {
    holder[cacheKey] = readStoreIndex();
  }
  return holder[cacheKey]!;
}
