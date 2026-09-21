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
import { corpus } from "./quests/catalogue";
import { AUDIO_DIR } from "./paths";

export const SUBFOLDERS = ["quests", "gossip"] as const;

export function subfolder(line: Pick<CorpusLine, "source">): "quests" | "gossip" {
  return line.source === "gossip" ? "gossip" : "quests";
}

/** Store-relative path, e.g. "quests/5-accept.mp3". Also the /api/quests/audio/ route path. */
export function audioRelPath(line: Pick<CorpusLine, "source" | "fileName">): string {
  return `${subfolder(line)}/${line.fileName}.mp3`;
}

/**
 * A line for each store path, the reverse of audioRelPath.
 *
 * One line, not the group: everything that shares a file shares its text and its voice, which
 * is the whole reason they share the file. So the first is as good as any for "what would be
 * spoken for this mp3", which is what staleness needs to know.
 *
 * Also the whitelist of paths the corpus can address, and the reason the history playback
 * route is traversal-proof by construction: a path either names a file some corpus line owns
 * or it does not exist, and no amount of `../` produces a key of this map. Membership does
 * not depend on what is on disk -- an archived take can be served for a line whose current
 * audio is missing.
 *
 * Memoised on the corpus's identity: 17,507 entries built once rather than per request, and
 * rebuilt exactly when the catalogue is.
 */
const fileIndexKey = Symbol.for("wow-voiceover.file-index");
type FileIndexHolder = { [fileIndexKey]?: { lines: CorpusLine[]; index: Map<string, CorpusLine> } };

export async function fileIndex(): Promise<Map<string, CorpusLine>> {
  const lines = (await corpus()).lines;
  const holder = globalThis as FileIndexHolder;

  if (!holder[fileIndexKey] || holder[fileIndexKey].lines !== lines) {
    const index = new Map<string, CorpusLine>();
    for (const line of lines) {
      const file = audioRelPath(line);
      if (!index.has(file)) index.set(file, line);
    }
    holder[fileIndexKey] = { lines, index };
  }
  return holder[fileIndexKey].index;
}

/**
 * Which of the store's clips this machine holds. Test-only: whether a line has audio is a
 * take row, and a clip missing here is reported by the player, not read as ungenerated.
 */
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

