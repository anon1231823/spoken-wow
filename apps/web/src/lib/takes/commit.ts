/**
 * Committing a take, for all three sections.
 *
 * This used to be written three times -- quests in generation/history.ts, zones through the
 * pipeline's store.mjs, books in books/store.ts -- and a rule changed in one did not reach
 * the others. The one that mattered: what to do when the store holds a clip no row
 * describes. Quests refused, books overwrote it silently, and zones archived it under a
 * name counted from the directory that a real take could later collide with. All three
 * now do the same thing, which is to keep it.
 *
 * THE ORDER, and what a crash at each point leaves behind:
 *
 *   1. preserve what is in the store: archive it under its own take, or record it as one
 *   2. write the new bytes into the archive, under a name that includes their hash
 *   3. in one transaction, insert the new row and make it the live one
 *   4. copy the new bytes into the store, which is what the addon ships
 *
 * Nothing is ever overwritten before it has a copy elsewhere, so no crash loses audio:
 *   - after 2, an archive file no row names: unreferenced, harmless
 *   - after 3, the row is live and its bytes are archived, but the store still holds the
 *     previous take until the next commit or restore rewrites it
 *
 * The archive is the record of every take's bytes; the store is a copy of whichever one is
 * live.
 *
 * The caller holds the file's lock, `${source}:${file}` (generation/lock.ts), across the
 * whole generation, so that two requests for one line cannot both spend credits. Every
 * section's regeneration and the restore route take the same key.
 */
import "server-only";

import path from "node:path";

import { db, query } from "@/lib/db";
import type { Source } from "@/lib/sections";

import { historyDirOf, storePathOf } from "./adapters";
import { archiveName, contentId, contentIdIn, readIfPresent, writeAtomic } from "./bytes";

/** What a take was made with. Anything unknown is null, which means unknown, not unchanged. */
export type TakeFields = {
  lineId: string;
  voice?: string | null;
  narratorVoice?: string | null;
  voiceId?: string | null;
  modelId?: string | null;
  seed?: number | null;
  outputFormat?: string | null;
  settings?: unknown;
  characters?: number | null;
  credits?: number | null;
  spokenHash?: string | null;
  dictionaryId?: string | null;
  dictionaryVersion?: string | null;
  /**
   * Whether the request carried a lead-in, and how many seconds were cut off the front.
   * True with a null length is a take that asked for one and did not get it, so it still
   * has the ramp-up in it. See lib/generation/leadin.ts. False when omitted: a take this
   * app did not cut never had one.
   */
  leadIn?: boolean;
  leadInSec?: number | null;
  createdBy?: string | null;
};

export type Committed = {
  version: number;
  bytes: number;
  archiveFile: string;
  durationSec: number | null;
};

type Row = { version: number; isCurrent: boolean; archiveFile: string | null; bytes: number };

/**
 * Write a new take and make it live.
 *
 * `measure` reads a clip's duration, where a section records one. It is given the archived
 * copy, which is written before the store is.
 */
export async function commitTake(
  source: Source,
  file: string,
  data: Buffer,
  fields: TakeFields,
  options: { lang?: string; measure?: (clip: string) => Promise<number | null> } = {},
): Promise<Committed> {
  const lang = options.lang ?? "enUS";
  const store = storePathOf(source, file);
  const history = historyDirOf(source, file);

  const [rows, current] = await Promise.all([
    query<Row>(
      `select "version", "isCurrent", "archiveFile", "bytes"::float8 as "bytes" from "take"
        where "source" = $1 and "file" = $2 and "lang" = $3`,
      [source, file, lang],
    ),
    readIfPresent(store),
  ]);
  let next = rows.reduce((max, row) => Math.max(max, row.version), 0) + 1;

  // 1. Whatever is in the store now, kept.
  if (current && (await preserve({ source, file, lang, history, rows, next, current, fields }))) {
    next += 1;
  }

  // 2. The new bytes, archived under their own name before anything points at them.
  const archiveFile = archiveName(next, data);
  const archived = path.join(history, archiveFile);
  await writeAtomic(archived, data);
  const durationSec = options.measure ? await options.measure(archived) : null;

  // 3. The row, live.
  await insertLive({
    source,
    file,
    lang,
    version: next,
    fields,
    bytes: data.byteLength,
    durationSec,
    archiveFile,
  });

  // 4. The store, last.
  await writeAtomic(store, data);

  return { version: next, bytes: data.byteLength, archiveFile, durationSec };
}

/**
 * Make sure the clip in the store survives being written over. True when that took a new
 * take number, which the caller's own take then has to follow.
 *
 * Three cases, decided from the rows and the bytes themselves rather than a directory
 * listing:
 *
 *   - some take already has these bytes archived: nothing to do
 *   - the live take has never been archived: archive it now, under its own version,
 *     and record where
 *   - no take describes these bytes: record them as a take of their own, `imported`
 *
 * The third is a crash between writing the store and recording the row, a file that
 * arrived by rsync, or a database restored from before the take was cut. Before, each
 * section either refused to continue, overwrote the clip, or filed it under a guessed name.
 * Now it becomes part of the line's history, and can be restored like any other take.
 */
async function preserve(input: {
  source: Source;
  file: string;
  lang: string;
  history: string;
  rows: Row[];
  next: number;
  current: Buffer;
  fields: TakeFields;
}): Promise<boolean> {
  const { source, file, lang, history, rows, next, current, fields } = input;

  if (await describedBy(rows, history, current)) return false;

  const live = rows.find((row) => row.isCurrent);
  if (live && !live.archiveFile) {
    const name = archiveName(live.version, current);
    await writeAtomic(path.join(history, name), current);
    await query(
      `update "take" set "archiveFile" = $5
        where "source" = $1 and "file" = $2 and "lang" = $3 and "version" = $4`,
      [source, file, lang, live.version, name],
    );
    return false;
  }

  const name = archiveName(next, current);
  await writeAtomic(path.join(history, name), current);
  await query(
    `insert into "take"
       ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes",
        "archiveFile")
     values ($1, $2, $3, $4, $5, false, 'imported', $6, $7)`,
    [source, lang, file, fields.lineId, next, current.byteLength, name],
  );
  return true;
}

/**
 * Whether some take of this file already has exactly these bytes in the archive.
 *
 * A name carrying a content id answers without reading anything. Names from before they
 * carried one are compared byte for byte -- but only for takes whose recorded size matches,
 * and the live take first, since the store almost always holds exactly that. Everything
 * else is never read.
 */
async function describedBy(rows: Row[], history: string, bytes: Buffer): Promise<boolean> {
  const id = contentId(bytes);
  const candidates = rows
    .filter((row) => row.archiveFile)
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  for (const row of candidates) {
    const embedded = contentIdIn(row.archiveFile!);
    if (embedded !== null) {
      if (embedded === id) return true;
      continue;
    }
    if (row.bytes !== bytes.byteLength) continue;
    const archived = await readIfPresent(path.join(history, row.archiveFile!));
    if (archived && archived.equals(bytes)) return true;
  }
  return false;
}

/** Insert one take and make it the only live one, in one transaction. */
async function insertLive(input: {
  source: Source;
  file: string;
  lang: string;
  version: number;
  fields: TakeFields;
  bytes: number;
  durationSec: number | null;
  archiveFile: string;
}): Promise<void> {
  const { source, file, lang, version, fields } = input;
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      `update "take" set "isCurrent" = false
        where "source" = $1 and "file" = $2 and "lang" = $3 and "isCurrent"`,
      [source, file, lang],
    );
    await client.query(
      `insert into "take"
         ("source", "lang", "file", "lineId", "version", "isCurrent", "origin",
          "voice", "narratorVoice", "voiceId", "modelId", "seed", "outputFormat", "settings",
          "characters", "credits", "durationSec", "bytes", "spokenHash", "dictionaryId",
          "dictionaryVersion", "leadIn", "leadInSec", "createdBy", "archiveFile")
       values ($1, $2, $3, $4, $5, true, 'generated', $6, $7, $8, $9, $10, $11, $12::jsonb,
               $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
      [
        source,
        lang,
        file,
        fields.lineId,
        version,
        fields.voice ?? null,
        fields.narratorVoice ?? null,
        fields.voiceId ?? null,
        fields.modelId ?? null,
        fields.seed ?? null,
        fields.outputFormat ?? null,
        fields.settings === undefined || fields.settings === null
          ? null
          : JSON.stringify(fields.settings),
        fields.characters ?? null,
        fields.credits ?? null,
        input.durationSec,
        input.bytes,
        fields.spokenHash ?? null,
        fields.dictionaryId ?? null,
        fields.dictionaryVersion ?? null,
        fields.leadIn ?? false,
        fields.leadInSec ?? null,
        fields.createdBy ?? null,
        input.archiveFile,
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
