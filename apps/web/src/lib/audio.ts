/**
 * A quests line's audio path as the addon resolves it: {quests,gossip}/<fileName>.mp3.
 *
 * `fileName` comes from the corpus, computed by Python. The only naming decision made on
 * this side is which subdirectory a line lives in, and it lives here alone - it is the
 * TypeScript twin of subfolder_from_line_id in tts_cli/naming.py.
 */
import type { CorpusLine } from "./corpus";
import { corpus } from "./quests/catalogue";

export const SUBFOLDERS = ["quests", "gossip"] as const;

export function subfolder(line: Pick<CorpusLine, "source">): "quests" | "gossip" {
  return line.source === "gossip" ? "gossip" : "quests";
}

/** The addon's path, e.g. "quests/5-accept.mp3". Also the take's `file` and the /api/quests/audio/ route path. */
export function audioRelPath(line: Pick<CorpusLine, "source" | "fileName">): string {
  return `${subfolder(line)}/${line.fileName}.mp3`;
}

/**
 * A line for each audio path, the reverse of audioRelPath.
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
