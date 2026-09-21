/**
 * The bytes of every take: reading and writing audio-history/.
 *
 * Layout mirrors the store one level deeper, so a version is addressable by path alone:
 *
 *     audio-history/gossip/31ab172e1a375db1c9157d594eb608d9/1.mp3
 *     audio-history/quests/5-accept/2.mp3
 *
 * Versions start at 1. There is no version 0: a line has either been generated or it has
 * not, and a number for "the take before the first take" only ever described how little
 * the database knew. What the database does not know it records as null -- the settings,
 * the seed, the voice -- and the take itself is version 1 like any other first take.
 *
 * Nothing here touches the database. versions.ts is the record of what these files are;
 * this is the files, and nothing here is ever consulted to decide what exists.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { AUDIO_DIR, AUDIO_HISTORY_DIR } from "@/lib/paths";
import { isSafeAudioPath } from "@/lib/range";

/**
 * NOTHING HERE DELETES A TAKE. This used to keep the newest five and discard the rest,
 * because the store is 1.1 GB on storage backed up by hand. That traded away the one thing
 * an archive is for: the fifth re-roll of a line silently destroyed the take somebody might
 * want back, and a re-roll is exactly when they want it. Audio files are now kept, and
 * reclaiming space is a deliberate job for a cleanup process that does not exist yet --
 * when it does, it belongs here, with a rule someone chose and can read.
 */

function assertSafe(file: string): void {
  // Whitelist, not sanitisation: `file` reaches this from a request body, and the same
  // pattern already guards /api/quests/audio.
  if (!isSafeAudioPath(file)) throw new Error(`unsafe store path ${file}`);
}

export function storePath(file: string): string {
  assertSafe(file);
  return path.join(AUDIO_DIR, file);
}

/** The directory holding every take of one file. */
export function historyDir(file: string): string {
  assertSafe(file);
  const sub = path.dirname(file);
  const name = path.basename(file, ".mp3");
  return path.join(AUDIO_HISTORY_DIR, sub, name);
}

export function versionPath(file: string, version: number): string {
  // Versions are 1-based, so 0 is as wrong as -1 here rather than a special case.
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`bad version ${version}`);
  }
  return path.join(historyDir(file), `${version}.mp3`);
}

export async function storeFileExists(file: string): Promise<boolean> {
  try {
    await fs.access(storePath(file));
    return true;
  } catch {
    return false;
  }
}

export async function storeFileBytes(file: string): Promise<number | null> {
  try {
    return (await fs.stat(storePath(file))).size;
  } catch {
    return null;
  }
}

/**
 * Write bytes into the store.
 *
 * `.part`-then-rename, the same atomic write storeSample uses: rename is atomic within a
 * filesystem, so a reader - or the addon build - can never see a half-written mp3. The
 * leading dot keeps an interrupted write out of readStoreIndex, which matches only *.mp3.
 */
export async function writeStoreFile(file: string, data: Buffer): Promise<void> {
  const target = storePath(file);
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

/** Copy what is in the store now into history at `version`. Returns its size. */
export async function archiveStoreFile(file: string, version: number): Promise<number> {
  const source = storePath(file);
  const target = versionPath(file, version);
  await fs.mkdir(path.dirname(target), { recursive: true });

  const partial = `${target}.part`;
  try {
    await fs.copyFile(source, partial);
    await fs.rename(partial, target);
  } catch (error) {
    await fs.rm(partial, { force: true });
    throw error;
  }
  return (await fs.stat(target)).size;
}


