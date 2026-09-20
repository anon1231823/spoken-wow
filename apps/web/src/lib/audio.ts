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

import { loadCorpus, type CorpusLine } from "./corpus";
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
 * Every store path the corpus can address.
 *
 * A whitelist, and the reason the history playback route is traversal-proof by construction:
 * a path either names a file some corpus line owns or it does not exist, and no amount of
 * `../` produces a member of this set. Same reasoning as isVoiceSlot for voice names.
 *
 * Distinct from storeIndex, which is what is *on disk*. An archived take can be served for a
 * line whose current audio is missing, so membership here cannot depend on the store.
 */
const corpusFilesKey = Symbol.for("wow-voiceover.corpus-files");
type FilesHolder = { [corpusFilesKey]?: Set<string> };

export function corpusFiles(): Set<string> {
  const holder = globalThis as FilesHolder;
  if (!holder[corpusFilesKey]) {
    holder[corpusFilesKey] = new Set(loadCorpus().lines.map(audioRelPath));
  }
  return holder[corpusFilesKey]!;
}

/**
 * A line for each store path, the reverse of audioRelPath.
 *
 * One line, not the group: everything that shares a file shares its text and its voice, which
 * is the whole reason they share the file. So the first is as good as any for "what would be
 * spoken for this mp3", which is what staleness needs to know.
 *
 * Beside corpusFiles because they are the same walk over the same lines, and memoised for the
 * same reason: 17,507 entries built once rather than per request.
 */
const fileIndexKey = Symbol.for("wow-voiceover.file-index");
type FileIndexHolder = { [fileIndexKey]?: Map<string, CorpusLine> };

export function fileIndex(): Map<string, CorpusLine> {
  const holder = globalThis as FileIndexHolder;
  if (!holder[fileIndexKey]) {
    const index = new Map<string, CorpusLine>();
    for (const line of loadCorpus().lines) {
      const file = audioRelPath(line);
      if (!index.has(file)) index.set(file, line);
    }
    holder[fileIndexKey] = index;
  }
  return holder[fileIndexKey]!;
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

/**
 * WHAT IS ON DISK NO LONGER DECIDES WHAT HAS AUDIO. That question is a take row now
 * (voicedFiles in lib/generation/versions.ts), the way zones and books have always
 * answered it -- a directory listing can say a file exists, but not which take is live,
 * what it cost, or whether it is the one somebody restored.
 *
 * readStoreIndex survives because two jobs still genuinely ask the disk: the backfill that
 * gives every inherited clip a take row, and its --reconcile pass that retires a row whose
 * file an rsync deleted. Those are the seam where the store and the table are compared, and
 * comparing them needs both sides.
 *
 * The memoised storeIndex(), its directory-mtime stamp and noteStored() are gone with the
 * search path that used them. They existed because a search read this per request and two
 * pm2 workers had to agree about a file one of them had just written; nothing reads it per
 * request any more, and a cache nobody reads is a thing to keep in step for no reason.
 */
