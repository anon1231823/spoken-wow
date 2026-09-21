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

import path from "node:path";

import { db, query } from "@/lib/db";
import type { Source } from "@/lib/generation/queue";

import { archiveNameFor } from "./archive";
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

/**
 * Where a take's bytes are, as a name inside its line's history directory.
 *
 * NOTHING HERE LOOKS AT THE DISK. The database is what says a take exists, and a row that
 * records its own `archiveFile` needs nothing worked out about it. Rows written before that
 * column fall back to the naming rule their section has always used, which is a fact about
 * how the file was written rather than a guess about what is there.
 *
 * This used to read the directory and mark a take unplayable when its bytes were missing,
 * so that a history panel could grey it out. That made rendering a list of takes depend on
 * a filesystem -- and on the droplet, where the archive is not where the app is, it made
 * every past take look like it had been lost. Whether the bytes are really there is a
 * question for the moment somebody plays or restores them, and both of those say so when
 * they fail.
 */
export function archiveNameOf(source: Source, take: Pick<Take, "version" | "archiveFile">): string {
  return take.archiveFile ?? archiveNameFor(source, take.version);
}

/**
 * Every take of one file, newest first.
 *
 * The same shape the panel draws, and it is one query: what a take is, who made it and what
 * it cost are all columns.
 */
export async function takeHistory(
  source: Source,
  file: string,
  lang = "enUS",
): Promise<Take[]> {
  return listTakes(source, file, lang);
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

/**
 * Absolute path of one archived take, for streaming or copying it back.
 *
 * The one place a take's bytes are located, and it is called only by the two things that
 * actually touch them: the audio route and the restore. Neither exists to render anything.
 */
export function archivePath(source: Source, file: string, name: string): string {
  return path.join(historyDirOf(source, file), name);
}

/** The archived file of one take, or null when the take was never recorded. */
export async function archiveFileOf(
  source: Source,
  file: string,
  version: number,
  lang = "enUS",
): Promise<string | null> {
  const rows = await query<{ version: number; archiveFile: string | null }>(
    `select "version", "archiveFile" from "take"
      where "source" = $1 and "file" = $2 and "lang" = $3 and "version" = $4`,
    [source, file, lang, version],
  );
  return rows[0] ? archiveNameOf(source, rows[0]) : null;
}
