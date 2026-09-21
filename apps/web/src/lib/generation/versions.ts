/**
 * Quests' view of the take table, in the shapes its search and routes read.
 *
 * All of it is one query -- liveTakes() in lib/takes/store.ts, which zones and books read
 * too. What is here is only the quests-shaped projection of it: a set of voiced files, a
 * map of live takes, a map of dates.
 *
 * THE DATABASE ANSWERS "HAS AUDIO", not a readdir of the store. A take is a row; a clip
 * this machine does not hold is a missing file, reported by the player when somebody asks
 * to hear it -- never a line that reads as ungenerated.
 */
import { liveTakes as liveRows } from "@/lib/takes/store";

/** Every quests file that has a live take: the set the explorer means by "has audio". */
export async function voicedFiles(): Promise<Set<string>> {
  return new Set((await liveRows("quests")).map((row) => row.file));
}

/**
 * The live take of every quests file, with how many takes that file has.
 *
 * PUBLIC, like the same two numbers on a zones or books row: which take is playing and how
 * many exist say nothing a listener should not see.
 */
export async function liveTakes(): Promise<Map<string, { version: number; takes: number }>> {
  return new Map(
    (await liveRows("quests")).map((row) => [row.file, { version: row.version, takes: row.takes }]),
  );
}

/**
 * When the live take of each file was generated, as epoch milliseconds.
 *
 * The live take only, not the newest row: restoring an older take makes that take's date
 * the answer again.
 */
export async function generatedAt(): Promise<Map<string, number>> {
  return new Map(
    (await liveRows("quests")).map((row) => [row.file, row.createdAt.getTime()]),
  );
}
