// Which books audio paths exist, and which are allowed to be asked for.

import "server-only";

import path from "node:path";

import { catalogue, BASE_LANG } from "./catalogue";
import type { Lang } from "@/lib/lang";

/**
 * The books audio archive: every take of every page, one directory per file.
 *
 * Env-overridden in production the way lib/paths.ts's exports are, and assembled from a
 * joined array for the reason stated there at length: Next's file tracer statically
 * evaluates a path.resolve() whose arguments are all literals and copies the resolved
 * directory into the standalone bundle. One segment kept out of the literal makes the
 * expression opaque to the tracer and identical at runtime.
 */
const PIPELINE_DIR = ["pipelines", "books"].join(path.sep);

export function historyDir(): string {
  return (
    process.env.SPOKEN_BOOKS_AUDIO_HISTORY ??
    path.join(path.resolve(process.cwd(), "..", "..", PIPELINE_DIR), "audio-history")
  );
}

/** Store-relative, e.g. '1381.mp3'. Also the /api/books/audio/ route path. */
export function audioRelPath(file: string): string {
  return `${file}.mp3`;
}

// Every path the corpus can address. The guard against traversal is set membership rather
// than string inspection: a path either names a file some page owns or it does not exist,
// and no amount of "../" produces a member of this set. lib/zones/audio.ts makes the same
// argument for the zones store.
export async function addressableFiles(lang: Lang = BASE_LANG): Promise<Set<string>> {
  return new Set((await catalogue(lang)).map((page) => audioRelPath(page.file)));
}

export async function isAddressable(relPath: string, lang: Lang = BASE_LANG): Promise<boolean> {
  return (await addressableFiles(lang)).has(relPath);
}
