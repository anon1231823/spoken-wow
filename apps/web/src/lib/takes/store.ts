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

import { archiveNameFor } from "./archive";
import { historyDirOf, storePathOf } from "./adapters";
import type { Source } from "@/lib/sections";

export type Take = {
  version: number;
  isCurrent: boolean;
  origin: "imported" | "generated";
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

/** The version of the live take of one file, or null when it has never been generated. */
export async function liveVersion(
  source: Source,
  file: string,
  lang = "enUS",
): Promise<number | null> {
  const rows = await query<{ version: number }>(
    `select "version" from "take"
      where "source" = $1 and "file" = $2 and "lang" = $3 and "isCurrent"`,
    [source, file, lang],
  );
  return rows[0]?.version ?? null;
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

/**
 * Absolute path of one archived take, for streaming or copying it back.
 *
 * The one place a take's bytes are located, and it is called only by the two things that
 * actually touch them: the audio route and the restore. Neither exists to render anything.
 */
export function archivePath(source: Source, file: string, name: string): string {
  return path.join(historyDirOf(source, file), name);
}

/**
 * Where one take's bytes are, absolute, or null when no such take was ever recorded.
 *
 * The live take is in the store; every other take is in the archive. That is not a
 * fallback, it is the layout: the store holds exactly one clip per line, the one the addon
 * ships, and the archive holds the rest.
 *
 * It matters because a take can be live without ever having been archived. Audio the CLI
 * narrated before any of this kept records has one row and one file, in the store, and
 * looking for it under audio-history/ would be looking for a copy nothing had reason to
 * make. commitVersion archives the live take before it overwrites it, so the copy appears
 * exactly when it is needed.
 *
 * One query. Whether the take is live is a column, not something to infer from a second
 * lookup that could disagree with the first.
 */
export async function takePath(
  source: Source,
  file: string,
  version: number,
  lang = "enUS",
): Promise<string | null> {
  const rows = await query<Pick<Take, "version" | "archiveFile" | "isCurrent">>(
    `select "version", "archiveFile", "isCurrent" from "take"
      where "source" = $1 and "file" = $2 and "lang" = $3 and "version" = $4`,
    [source, file, lang, version],
  );
  const take = rows[0];
  if (!take) return null;
  return take.isCurrent
    ? storePathOf(source, file)
    : archivePath(source, file, archiveNameOf(source, take));
}
