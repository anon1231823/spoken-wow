/**
 * The bytes of every take: reading and writing audio-history/.
 *
 * Layout mirrors the store one level deeper, so a version is addressable by path alone:
 *
 *     audio-history/gossip/31ab172e1a375db1c9157d594eb608d9/0.mp3
 *     audio-history/quests/5-accept/1.mp3
 *
 * Version 0 is always the take that predates this app, and the only copy of audio the
 * project cannot reproduce: its settings, seed and often its voice are unknown.
 *
 * Nothing here touches the database. versions.ts is the record of what these files are;
 * this is the files.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { AUDIO_DIR, AUDIO_HISTORY_DIR } from "@/lib/paths";
import { isSafeAudioPath } from "@/lib/range";

/**
 * NOTHING HERE DELETES A TAKE. This used to keep version 0 plus the newest four and discard
 * the rest, because the store is 1.1 GB on storage backed up by hand. That traded away the
 * one thing an archive is for: the fifth re-roll of a line silently destroyed the take
 * somebody might want back, and a re-roll is exactly when they want it. Audio files are now
 * kept, and reclaiming space is a deliberate job for a cleanup process that does not exist
 * yet -- when it does, it belongs here, with a rule someone chose and can read.
 *
 * Version 0 is still the take that predates this app, and is still the one nothing can
 * reproduce: the settings, the seed and often the voice are unknown.
 */
export const INHERITED_VERSION = 0;

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
  if (!Number.isInteger(version) || version < 0) {
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

/** Version numbers present on disk, ascending. Independent of what the database believes. */
export async function versionsOnDisk(file: string): Promise<number[]> {
  let names: string[];
  try {
    names = await fs.readdir(historyDir(file));
  } catch {
    // No history yet is the normal state for all but a handful of files.
    return [];
  }
  return names
    .filter((name) => /^\d+\.mp3$/.test(name))
    .map((name) => Number(name.slice(0, -4)))
    .sort((a, b) => a - b);
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

/** Put an archived take back into the store. */
export async function restoreVersionFile(file: string, version: number): Promise<Buffer> {
  const data = await fs.readFile(versionPath(file, version));
  await writeStoreFile(file, data);
  return data;
}

