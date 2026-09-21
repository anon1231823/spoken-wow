/**
 * Putting audio bytes on disk, and naming them.
 *
 * Every write here is `.part`-then-rename: rename is atomic within a filesystem, so a
 * reader -- the audio routes, the addon build -- never sees half a clip. The leading dot
 * keeps an interrupted write out of anything that lists *.mp3.
 *
 * This used to be written six times -- per store and archive per section, and once more
 * for voice samples -- and the copies had drifted: some cleaned up their `.part` file on
 * failure and some left it, some used a leading dot and some did not.
 */
import "server-only";

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** First eight hex digits of the SHA-256 of `data`. Enough to tell takes of one line apart. */
export function contentId(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 8);
}

/**
 * The name a take's bytes are archived under: `v3-1a2b3c4d.mp3`.
 *
 * The version keeps it readable; the content hash makes it unique. Before this, archive
 * names were derived from something that could be missing or collide -- a take version,
 * which a clip with no row does not have, or a count of the directory, which could land on
 * a name a real take would later want. With the bytes in the name, two different clips can
 * never share one, and archiving the same clip twice writes the same file twice, which is
 * harmless.
 *
 * Only takes cut from here on are named this way. Files already on disk keep whatever
 * name they were written under, and their rows record it in `archiveFile`.
 */
export function archiveName(version: number, data: Buffer): string {
  return `v${version}-${contentId(data)}.mp3`;
}

/** The content id embedded in an archive name, or null for a name from before they had one. */
export function contentIdIn(name: string): string | null {
  return /^v\d+-([0-9a-f]{8})\.mp3$/.exec(name)?.[1] ?? null;
}

/** Run `fill` against a dotted `.part` beside `target`, then rename it into place. */
async function atomically(target: string, fill: (partial: string) => Promise<void>) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const partial = path.join(path.dirname(target), `.${path.basename(target)}.part`);
  try {
    await fill(partial);
    await fs.rename(partial, target);
  } catch (error) {
    await fs.rm(partial, { force: true });
    throw error;
  }
}

/** Write `data` to `target`, atomically. */
export function writeAtomic(target: string, data: Buffer): Promise<void> {
  return atomically(target, (partial) => fs.writeFile(partial, data));
}

/** Copy `source` to `target`, atomically. A copy, never a move: archived audio stays put. */
export function copyAtomic(source: string, target: string): Promise<void> {
  return atomically(target, (partial) => fs.copyFile(source, partial));
}

/** The file's bytes, or null when there is no such file. */
export async function readIfPresent(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}
