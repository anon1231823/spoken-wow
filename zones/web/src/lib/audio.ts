// Which audio paths exist, and which are allowed to be asked for.

import "server-only";

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { catalogue } from "./catalogue";
import { HISTORY_DIR, SOUNDS_DIR } from "./tools";

export { HISTORY_DIR, SOUNDS_DIR };

/** Store-relative, e.g. '1411/razor-hill.mp3'. Also the /api/audio/ route path. */
export function audioRelPath(file: string): string {
  return `${file}.mp3`;
}

// Every path the catalogue can address. The guard against traversal is set membership
// rather than string inspection: a path either names a file some line owns or it does
// not exist, and no amount of "../" produces a member of this set.
//
// Derived from naming.mjs's own file assignment, so a request can only reach a clip
// the addon could also reach. ../wow-voiceover/web/src/lib/audio.ts:30 makes the same
// argument.
const globalForFiles = globalThis as unknown as { zoneloreAudioFiles?: Promise<Set<string>> };

export function addressableFiles(): Promise<Set<string>> {
  if (!globalForFiles.zoneloreAudioFiles) {
    globalForFiles.zoneloreAudioFiles = catalogue().then(
      (entries) => new Set(entries.map((entry) => audioRelPath(entry.file))),
    );
  }
  return globalForFiles.zoneloreAudioFiles;
}

export async function isAddressable(relPath: string): Promise<boolean> {
  return (await addressableFiles()).has(relPath);
}

/** Which archived takes exist for a line, newest first. Empty when none do. */
export async function archivedVersions(file: string): Promise<number[]> {
  const names = await readdir(join(HISTORY_DIR, file)).catch(() => [] as string[]);
  return names
    .map((name) => /^v(\d+)\.mp3$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .sort((a, b) => b - a);
}
