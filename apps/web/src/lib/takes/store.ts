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
import { BASE_LANG, type Lang } from "@/lib/lang";

import { historyDirOf } from "./adapters";
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
  lang: Lang = BASE_LANG,
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

/** One section's live take of one file, with how many takes that file has. */
export type LiveTake = {
  lineId: string;
  file: string;
  version: number;
  /** Every take of this file, the live one included. */
  takes: number;
  spokenHash: string | null;
  characters: number | null;
  credits: number | null;
  durationSec: number | null;
  bytes: number;
  modelId: string | null;
  voiceId: string | null;
  createdAt: Date;
};

/**
 * The live take of every file in a section, and how many takes each has.
 *
 * One query for all three sections, which each used to write for themselves -- quests in
 * generation/versions.ts, zones and books in their catalogues -- and all three as a count
 * subquery per live row. Postgres does not flatten a scalar subquery in the select list,
 * so at eleven thousand quests files that was eleven thousand index scans on every
 * search. A grouped count joined once does the same in one pass.
 *
 * Counted by file, which is what take_current_idx is on. For zones and books a file and a
 * line are the same thing; a quests file is shared by every NPC who speaks it.
 */
export async function liveTakes(source: Source, lang: Lang = BASE_LANG): Promise<LiveTake[]> {
  return query<LiveTake>(
    `select t."lineId", t."file", t."version", c."takes", t."spokenHash", t."characters",
            t."credits", t."durationSec"::float8 as "durationSec", t."bytes"::float8 as "bytes",
            t."modelId", t."voiceId", t."createdAt"
       from "take" t
       join (select "file", count(*)::int as "takes" from "take"
              where "source" = $1 and "lang" = $2 group by "file") c using ("file")
      where t."source" = $1 and t."lang" = $2 and t."isCurrent"`,
    [source, lang],
  );
}

/** The version of the live take of one file, or null when it has never been generated. */
export async function liveVersion(
  source: Source,
  file: string,
  lang: Lang = BASE_LANG,
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
  lang: Lang = BASE_LANG,
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

/** Where one take's bytes are, or why there are none to read. */
export type TakeBytes =
  /** The take's clip, in its line's history directory. */
  | { kind: "file"; path: string }
  /** The take exists, and nothing kept its clip. */
  | { kind: "gone" }
  /** No such take was ever recorded. */
  | { kind: "none" };

/**
 * Where one take's bytes are, from its row alone -- the live take exactly like any other.
 *
 *   - archiveFile set: that file in the line's history directory
 *   - not set: the take happened and its clip was not kept -- pruned by the code before
 *     this branch, consumed by its rename-to-restore, or retired somewhere this archive
 *     never saw. Known to be gone, so nothing is looked for.
 *
 * Whether a named file is really there is answered by whoever reads it.
 */
export async function takePath(
  source: Source,
  file: string,
  version: number,
  lang: Lang = BASE_LANG,
): Promise<TakeBytes> {
  const rows = await query<Pick<Take, "archiveFile">>(
    `select "archiveFile" from "take"
      where "source" = $1 and "file" = $2 and "lang" = $3 and "version" = $4`,
    [source, file, lang, version],
  );
  return located(source, file, lang, rows[0]);
}

/** The live take's bytes, the way takePath finds any take's. What the live audio routes play. */
export async function livePath(source: Source, file: string, lang: Lang = BASE_LANG): Promise<TakeBytes> {
  const rows = await query<Pick<Take, "archiveFile">>(
    `select "archiveFile" from "take"
      where "source" = $1 and "file" = $2 and "lang" = $3 and "isCurrent"`,
    [source, file, lang],
  );
  return located(source, file, lang, rows[0]);
}

function located(
  source: Source,
  file: string,
  lang: Lang,
  take: Pick<Take, "archiveFile"> | undefined,
): TakeBytes {
  if (!take) return { kind: "none" };
  if (!take.archiveFile) return { kind: "gone" };
  return { kind: "file", path: path.join(historyDirOf(source, file, lang), take.archiveFile) };
}
