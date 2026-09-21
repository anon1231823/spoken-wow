/**
 * Putting an earlier take back, in one place for all three sections.
 *
 * Two steps and a third that only two sections need:
 *
 *   1. copy the archived clip into the store, because the store is what the addon plays
 *   2. move the live flag onto that take
 *   3. rebuild the section's lookup table, where it has one
 *
 * A COPY, NOT A MOVE. The zones and books stores used to rename the archived file back
 * into place, which meant restoring a take destroyed the only archived copy of it: undo
 * once, and the take just restored could never be found again. Nothing here deletes or
 * renames an archived file.
 *
 * NO NEW ROW. Every take is archived under its own version as it is cut, so the clip being
 * replaced is already safe and there are no bytes left over needing a number of their own.
 * The history is what this line has been, and a restore is a statement about which of those
 * is right -- the same thing it means for a lore version (lib/zones/lore.ts).
 */
import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import type { Source } from "@/lib/generation/queue";

import { storePathOf } from "./adapters";
import { setLiveTake, takePath } from "./store";

/**
 * Rebuild what the addon reads, for the sections that keep a lookup table.
 *
 * Imported lazily and per source, so a restore in one section never drags the other two's
 * pipeline modules into the bundle. Quests has no entry: its addon reads the corpus it
 * ships, and a take is found by filename.
 */
const PUBLISH: Partial<Record<Source, () => Promise<void>>> = {
  zones: async () => {
    const { publish } = await import("@/lib/zones/regenerate");
    await publish();
  },
  books: async () => {
    const { publish } = await import("@/lib/books/publish");
    await publish();
  },
};

export async function restoreTake(
  source: Source,
  file: string,
  version: number,
): Promise<void> {
  // The row is what says the take exists. A version nobody recorded is a caller asking for
  // something that never happened; a version whose BYTES are missing is a different failure
  // and belongs below, where the copy is attempted and says so.
  const source_path = await takePath(source, file, version);
  if (!source_path) throw new Error(`no version ${version} of ${file} in ${source}`);

  const target = storePathOf(source, file);
  // Already live: its bytes are the store file, and copying a file over itself truncates
  // it. Nothing to move, and the flag is where it belongs.
  if (source_path === target) return;

  await fs.mkdir(path.dirname(target), { recursive: true });

  // Copy beside the target and rename, the same atomic write every store here uses: rename
  // is atomic within a filesystem, so a reader - or the addon build - never sees half a
  // clip. The leading dot keeps an interrupted copy out of the quests store index, which
  // matches only *.mp3.
  //
  // THIS is where missing bytes are discovered, and the only place that should discover
  // them: nothing about drawing a list of takes depends on the archive being reachable, so
  // a restore that cannot find its clip fails here, with the path it looked for, and the
  // live flag is not moved.
  const partial = path.join(path.dirname(target), `.${path.basename(target)}.part`);
  try {
    await fs.copyFile(source_path, partial);
    await fs.rename(partial, target);
  } catch (error) {
    await fs.rm(partial, { force: true });
    const reason = (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "is not on disk" : "could not be read";
    throw new Error(`the audio of version ${version} of ${file} ${reason} (${source_path})`);
  }

  await setLiveTake(source, file, version);

  // Never fatal: the take IS restored by this point, and a failure here means the addon's
  // table is one rebuild behind, which the next drain fixes.
  await PUBLISH[source]?.().catch((error: unknown) => {
    console.error(`${source}: could not rebuild the lookup after a restore`, error);
  });
}
