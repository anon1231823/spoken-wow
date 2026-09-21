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

/** Write `data` to `target` through a dotted `.part` beside it, renamed into place. */
export async function writeAtomic(target: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const partial = path.join(path.dirname(target), `.${path.basename(target)}.part`);
  try {
    await fs.writeFile(partial, data);
    await fs.rename(partial, target);
  } catch (error) {
    await fs.rm(partial, { force: true });
    throw error;
  }
}
