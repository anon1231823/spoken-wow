// Which zones audio paths exist, and which are allowed to be asked for.

import "server-only";

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { catalogue } from "./catalogue";
import { BASE_LANG, type Lang } from "./lang";
import { historyDir, soundsDir } from "./tools";

export { historyDir, soundsDir };

/** Store-relative, e.g. '1411/razor-hill.mp3'. Also the /api/zones/audio/ route path. */
export function audioRelPath(file: string): string {
  return `${file}.mp3`;
}

// Every path the catalogue can address. The guard against traversal is set membership
// rather than string inspection: a path either names a file some line owns or it does
// not exist, and no amount of "../" produces a member of this set.
//
// Derived from naming.mjs's own file assignment, so a request can only reach a clip the
// addon could also reach. lib/audio.ts makes the same argument for the quests store.
//
// Not memoised separately. It is one pass over the catalogue, which is memoised and
// stamped against the table -- and a second memo here would be a second thing to keep in
// step with a corpus that changes, for a Set built in a millisecond from a list already in
// memory. The zones site kept one, and it was one more cache its by-hand invalidation had
// to remember.
export async function addressableFiles(lang: Lang = BASE_LANG): Promise<Set<string>> {
  return new Set((await catalogue(lang)).map((entry) => audioRelPath(entry.file)));
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
