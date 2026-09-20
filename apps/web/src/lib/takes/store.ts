/**
 * Every take of every line, for all three sections, over one table and one archive rule.
 *
 * The `take` table has held all three since migration 0020, but only the quests side ever
 * had a history panel to read it with: zones could undo its newest take and books had no
 * way back at all. The difference was never in the data. It was that each section reached
 * its own audio through its own module, so a panel written against one of them could not be
 * shown on the other two.
 *
 * This is the seam that makes them one. What differs between the sections is where the
 * bytes live and how a file is named -- frozen rules, per AGENTS.md -- so that is what the
 * adapter holds, and everything else is written once here.
 *
 * Keyed on `(source, file)` because that is what `take_current_idx` is on, and because a
 * quests file is spoken by several NPCs: "restore this line" is really "restore this file".
 */
import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { db, query } from "@/lib/db";
import type { Source } from "@/lib/generation/queue";

import { resolveArchive, type TakeRef } from "./archive";
import { historyDirOf } from "./adapters";

export type Take = {
  version: number;
  isCurrent: boolean;
  origin: "inherited" | "imported" | "generated";
  /** Where the bytes are, relative to the line's history directory, or null when unknown. */
  archiveFile: string | null;
  characters: number | null;
  credits: number | null;
  modelId: string | null;
  createdAt: string;
  createdByName: string | null;
};

/** A take as the history panel shows it: with whether its audio is actually there. */
export type PlayableTake = Take & { playable: boolean };

type Row = Omit<Take, "createdAt"> & { createdAt: Date };

const COLUMNS = `t."version", t."isCurrent", t."origin", t."archiveFile", t."characters",
                 t."credits", t."modelId", t."createdAt", u."name" as "createdByName"`;

/** Every take of one file, newest first, without asking the filesystem anything. */
export async function listTakes(
  source: Source,
  file: string,
  lang = "enUS",
): Promise<Take[]> {
  const rows = await query<Row>(
    `select ${COLUMNS}
       from "take" t
       left join "user" u on u."id" = t."createdBy"
      where t."source" = $1 and t."file" = $2 and t."lang" = $3
      order by t."version" desc`,
    [source, file, lang],
  );
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/** The history directory's contents, or nothing when the line has never been re-cut. */
async function archivedNames(source: Source, file: string): Promise<string[]> {
  return fs.readdir(historyDirOf(source, file)).catch(() => [] as string[]);
}

/**
 * Every take of one file, each marked with whether its bytes can actually be found.
 *
 * A take whose audio is gone stays in the list rather than being hidden: it is still a true
 * record that the take existed, and saying so is more useful than a history with holes in
 * it. The panel draws it greyed out and refuses to restore it.
 */
export async function takeHistory(
  source: Source,
  file: string,
  lang = "enUS",
): Promise<PlayableTake[]> {
  const [takes, names] = await Promise.all([
    listTakes(source, file, lang),
    archivedNames(source, file),
  ]);
  const found = resolveArchive(takes as TakeRef[], names);

  return takes.map((take) => ({
    ...take,
    // The live take's bytes are in the store whether or not they are also archived, so it
    // is playable on its own terms; everything else has to be findable in the archive.
    archiveFile: found.get(take.version) ?? null,
    playable: take.isCurrent || found.has(take.version),
  }));
}

/** The archived file holding one take's bytes, or null when it cannot be found for sure. */
export async function archiveNameOf(
  source: Source,
  file: string,
  version: number,
  lang = "enUS",
): Promise<string | null> {
  const [takes, names] = await Promise.all([
    listTakes(source, file, lang),
    archivedNames(source, file),
  ]);
  return resolveArchive(takes as TakeRef[], names).get(version) ?? null;
}

/**
 * Make one take the live one.
 *
 * In a transaction, because clearing the old flag and setting the new one must not half
 * apply: `take_current_idx` allows exactly one live take per file, so a half-applied pair
 * would either leave the file with none -- the export then ships nothing for that line --
 * or make the next write fail against the index, which looks like a bug in the next run
 * rather than in this one.
 */
export async function setLiveTake(
  source: Source,
  file: string,
  version: number,
  lang = "enUS",
): Promise<void> {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      `update "take" set "isCurrent" = false
        where "source" = $1 and "file" = $2 and "lang" = $3 and "isCurrent"`,
      [source, file, lang],
    );
    const { rowCount } = await client.query(
      `update "take" set "isCurrent" = true
        where "source" = $1 and "file" = $2 and "lang" = $3 and "version" = $4`,
      [source, file, lang, version],
    );
    if (rowCount === 0) {
      throw new Error(`no version ${version} of ${file} in ${source}`);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Record where a take's bytes were archived, so nothing has to work it out again. */
export async function noteArchiveFile(
  source: Source,
  file: string,
  version: number,
  name: string,
  lang = "enUS",
): Promise<void> {
  await query(
    `update "take" set "archiveFile" = $5
      where "source" = $1 and "file" = $2 and "lang" = $3 and "version" = $4`,
    [source, file, lang, version, name],
  );
}

/** Absolute path of one archived take, for streaming it back. */
export function archivePath(source: Source, file: string, name: string): string {
  return path.join(historyDirOf(source, file), name);
}
