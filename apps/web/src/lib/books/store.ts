/**
 * Where a book page's audio goes, and what the take records.
 *
 * The zones half of this lives in pipelines/zones/tools/voice/store.mjs because a CLI
 * shares it. Books has no generating CLI yet -- phase 4 -- so the same logic lives here,
 * written against the same shared `take` table and the same archive layout. When the books
 * CLI arrives this is what it extracts.
 *
 * The archive is not a nicety: it is what makes a bad re-roll reversible, and it has
 * exactly one correct moment -- after the replacement exists in memory and before it lands
 * on the path the old take occupies.
 */
import "server-only";

import { existsSync } from "node:fs";
import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { db, query } from "@/lib/db";

import { soundsDir } from "./audio";
import { BASE_LANG } from "./catalogue";

const SOURCE = "books";

/** Previous takes, one directory per file, beside the live store. */
export function historyDir(): string {
  return process.env.SPOKEN_BOOKS_AUDIO_HISTORY ?? `${soundsDir()}-history`;
}

/** What one generated take records. Mirrors the columns migration 0020 merged. */
export type TakeRecord = {
  file: string;
  textHash: string;
  chars: number;
  credits: number | null;
  durationSec: number | null;
  bytes: number;
  voiceId: string | null;
  modelId: string | null;
  outputFormat: string | null;
  dictionaryId: string | null;
  dictionaryVersionId: string | null;
  /** Whether the request carried a lead-in. See lib/generation/leadin.ts. */
  leadIn: boolean;
  /** Seconds cut off the front, or null when the lead-in was asked for and not found. */
  leadInSec: number | null;
  generatedAt: string;
};

/**
 * Records a take and makes it the live one.
 *
 * Retired and numbered BY FILE rather than by line, because that is what the table's
 * partial unique index is on. Here the two are the same key -- one page is one file -- but
 * clearing by line and inserting by file is exactly how a second live take slips past.
 */
export async function insertTake(
  lineId: string,
  record: TakeRecord,
  origin: "generated" | "imported",
  settings: unknown = null,
  lang: string = BASE_LANG,
): Promise<number> {
  // A transaction opened here rather than through a helper, the way versions.ts and
  // lore.ts do it: retiring the live take and inserting its replacement must not half
  // apply, or the file has no current take at all.
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      `update "take" set "isCurrent" = false
        where "source" = $1 and "file" = $2 and "lang" = $3 and "isCurrent"`,
      [SOURCE, record.file, lang],
    );

    // The version comes from a select over this file's own rows rather than from the
    // caller, so nothing outside this transaction has to know or guess it.
    const { rows } = await client.query<{ version: number }>(
      `insert into "take" (
         "source", "lineId", "lang", "version", "isCurrent", "origin", "settings",
         "file", "spokenHash", "characters", "credits", "durationSec", "bytes",
         "voiceId", "modelId", "outputFormat", "dictionaryId", "dictionaryVersion",
         "leadIn", "leadInSec", "createdAt"
       )
       select $1, $2, $3, coalesce(max("version"), 0) + 1, true, $4, $5::jsonb,
              $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::timestamptz
         from "take"
        where "source" = $1 and "file" = $6 and "lang" = $3
       returning "version"`,
      [
        SOURCE,
        lineId,
        lang,
        origin,
        settings === null ? null : JSON.stringify(settings),
        record.file,
        record.textHash,
        record.chars,
        record.credits,
        record.durationSec,
        record.bytes,
        record.voiceId,
        record.modelId,
        record.outputFormat,
        record.dictionaryId,
        record.dictionaryVersionId,
        record.leadIn,
        record.leadInSec,
        record.generatedAt,
      ],
    );

    await client.query("commit");
    return rows[0].version;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Moves the live clip to audio-history/{file}/v{n}.mp3.
 *
 * A rename, not a copy: the bytes are about to be replaced either way. Numbered from what
 * is already archived rather than from take."version", so the archive stays readable
 * without a database -- which is the state a release path is in.
 */
async function archiveExisting(file: string, path: string): Promise<void> {
  if (!existsSync(path)) return;

  const dir = join(historyDir(), file);
  await mkdir(dir, { recursive: true });

  const existing = await readdir(dir).catch(() => [] as string[]);
  const highest = existing.reduce((max, name) => {
    const match = /^v(\d+)\.mp3$/.exec(name);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  await rename(path, join(dir, `v${highest + 1}.mp3`));
}

/** Writes a clip, archiving whatever it replaces. Returns the absolute path written. */
export async function writeAudio(file: string, buffer: Buffer): Promise<string> {
  const path = join(soundsDir(), `${file}.mp3`);

  await archiveExisting(file, path);
  await mkdir(dirname(path), { recursive: true });

  // Write beside the target and rename, so an interrupted run cannot leave a truncated mp3
  // that later looks like a finished one.
  const temp = `${path}.part`;
  await writeFile(temp, buffer);
  await rename(temp, path);

  return path;
}

/** Puts an archived take back on disk. No API call and no credits. */
export async function restoreTakeFile(file: string, archiveVersion: number): Promise<string> {
  const archived = join(historyDir(), file, `v${archiveVersion}.mp3`);
  if (!existsSync(archived)) throw new Error(`no archived take at ${archived}`);

  const path = join(soundsDir(), `${file}.mp3`);
  // Archive the clip being replaced first, so a restore is itself reversible.
  await archiveExisting(file, path);
  await mkdir(dirname(path), { recursive: true });
  await rename(archived, path);

  return path;
}

/** The settings a take was cut with, for reproducing it. Used by the restore path. */
export async function takeSettings(lineId: string, version: number, lang: string = BASE_LANG) {
  const rows = await query<{
    textHash: string;
    chars: number;
    voiceId: string | null;
    modelId: string | null;
    outputFormat: string | null;
    dictionaryId: string | null;
    dictionaryVersionId: string | null;
  }>(
    `select "spokenHash" as "textHash", "characters" as "chars", "voiceId", "modelId",
            "outputFormat", "dictionaryId", "dictionaryVersion" as "dictionaryVersionId"
       from "take"
      where "source" = $1 and "lineId" = $2 and "lang" = $3 and "version" = $4`,
    [SOURCE, lineId, lang, version],
  );
  return rows[0] ?? null;
}
