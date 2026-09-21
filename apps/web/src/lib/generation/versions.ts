/**
 * The record of every take: what it was made with, by whom, and which one is live.
 *
 * The disk holds the bytes (archive.ts); this holds what they mean, and this is the only
 * one of the two that is ever asked what exists. A take is a row. Whether its bytes are
 * reachable from the machine serving the page is a different question, asked at the moment
 * somebody plays or restores it and answered there.
 *
 * Every statement here names `"source" = 'quests'`. The `take` table holds both sides of the
 * site (see migration 0020), the two name files by different frozen rules, and a query that
 * forgot the source would be one that could return the other corpus's take for a colliding
 * path. Written out at each call site rather than hidden behind a helper, because it is a
 * correctness condition and the point is that it is visible in every query it belongs to.
 * The zones side reads the same table through its own module, keyed on the lineId.
 */
import { db } from "@/lib/db";

/** Versions for several files at once, so a search result does not make one query per line. */
export async function versionCounts(files: string[]): Promise<Map<string, number>> {
  if (files.length === 0) return new Map();
  const { rows } = await db().query<{ file: string; count: string }>(
    `select "file", count(*)::text as count
       from "take" where "source" = 'quests' and "file" = any($1::text[])
      group by "file"`,
    [files],
  );
  return new Map(rows.map((row) => [row.file, Number(row.count)]));
}

/**
 * Every quests file that has a live take: the set the explorer means by "has audio".
 *
 * THE DATABASE ANSWERS THIS NOW, not a readdir of the store. Zones and books have always
 * answered it from a take row, and one question with two implementations is one that
 * drifts: a directory listing cannot say which take is live, what it cost, or whether it
 * is the one somebody restored -- it can only say that a file with that name exists.
 *
 * A row outliving its file is not a reason to go back to the disk. The archive is
 * append-only and the store is whatever the last rsync left; the table is what the site and
 * the addon build are built from, so a file the local machine happens not to have is a
 * missing file, not a missing take. The player says so when it cannot fetch one.
 */
export async function voicedFiles(): Promise<Set<string>> {
  const { rows } = await db().query<{ file: string }>(
    `select "file" from "take" where "source" = 'quests' and "isCurrent"`,
  );
  return new Set(rows.map((row) => row.file));
}

/**
 * The live take of every quests file, with how many takes that file has.
 *
 * What a row needs to print its Audio column, and it is PUBLIC, like the same two numbers
 * on a zones or books row: which take is playing and how many exist say nothing a listener
 * should not see. It travels in the search result for that reason, rather than through the
 * collaborator-only counts endpoint -- which is how the column came to be blank for anyone
 * signed out, showing nothing where the other two sections show v1.
 *
 * One query with a count beside it rather than two: the panel asks both questions about the
 * same rows, and a file with one take is the overwhelming majority.
 */
export async function liveTakes(): Promise<Map<string, { version: number; takes: number }>> {
  const { rows } = await db().query<{ file: string; version: number; takes: string }>(
    // One grouped pass, not a count subquery per live row: Postgres does not flatten a
    // scalar subquery in the select list, and at 11,000 live files that was one index scan
    // each, on every search.
    `select "file", max("version") filter (where "isCurrent") as "version", count(*) as "takes"
       from "take"
      where "source" = 'quests'
      group by "lang", "file"
     having bool_or("isCurrent")`,
  );
  return new Map(
    rows.map((row) => [row.file, { version: row.version, takes: Number(row.takes) }]),
  );
}

/**
 * Which version is live for each of these files, so a row can say what it is playing.
 *
 * The live take rather than the highest, which are not the same thing once a restore has
 * moved the flag back down -- and saying "v5" over the bytes of v2 is exactly the kind of
 * quiet wrongness the take layer exists to avoid.
 */
export async function liveVersions(files: string[]): Promise<Map<string, number>> {
  if (files.length === 0) return new Map();
  const { rows } = await db().query<{ file: string; version: number }>(
    `select "file", "version"
       from "take"
      where "source" = 'quests' and "isCurrent" and "file" = any($1::text[])`,
    [files],
  );
  return new Map(rows.map((row) => [row.file, row.version]));
}

/**
 * When the live take of each file was generated, as epoch milliseconds.
 *
 * The live take only, not the newest row: what "this line was generated on Tuesday" means is
 * the audio you would play now, and restoring an older take makes that take's date the
 * answer again.
 *
 * Every file at once rather than by page, because the date filter runs over the whole match
 * set before paging. The table holds one row per file that this app has ever written, which
 * is a small fraction of the store - the corpus was generated by the CLI, which records
 * nothing here. Files with no row are absent from the map, which search.ts reads as
 * "generated before records began".
 */
export async function generatedAt(): Promise<Map<string, number>> {
  const { rows } = await db().query<{ file: string; createdAt: Date }>(
    `select "file", "createdAt" from "take" where "source" = 'quests' and "isCurrent"`,
  );
  return new Map(rows.map((row) => [row.file, row.createdAt.getTime()]));
}

