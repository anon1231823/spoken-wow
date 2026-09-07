// Which audio paths exist, and which are allowed to be asked for.

import "server-only";

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { catalogue } from "./catalogue";
import { BASE_LANG, type Lang } from "./lang";
import { historyDir, soundsDir } from "./tools";

export { historyDir, soundsDir };

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
// Keyed by language like the catalogue it is derived from, though every language
// addresses the same paths: `file` carries no language, because one sound pack addon
// ships one language and the language is the folder it ships in.
const globalForFiles = globalThis as unknown as {
  zoneloreAudioFiles?: Map<Lang, Promise<Set<string>>>;
};

export function addressableFiles(lang: Lang = BASE_LANG): Promise<Set<string>> {
  if (!globalForFiles.zoneloreAudioFiles) {
    globalForFiles.zoneloreAudioFiles = new Map();
  }
  const memo = globalForFiles.zoneloreAudioFiles;
  if (!memo.has(lang)) {
    memo.set(
      lang,
      catalogue(lang).then((entries) => new Set(entries.map((entry) => audioRelPath(entry.file)))),
    );
  }
  return memo.get(lang)!;
}

export async function isAddressable(relPath: string, lang: Lang = BASE_LANG): Promise<boolean> {
  return (await addressableFiles(lang)).has(relPath);
}

/** Which archived takes exist for a line, newest first. Empty when none do. */
export async function archivedVersions(file: string, lang: Lang = BASE_LANG): Promise<number[]> {
  const names = await readdir(join(historyDir(lang), file)).catch(() => [] as string[]);
  return names
    .map((name) => /^v(\d+)\.mp3$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .sort((a, b) => b - a);
}
