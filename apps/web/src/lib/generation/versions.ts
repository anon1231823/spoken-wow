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

import type { VoiceSettings } from "./config";

/**
 * `imported` is for takes this app did not cut: the corpus the CLI narrated before any of
 * this recorded anything, and the zones audio that came in from the old droplet. It means
 * the settings, the seed and often the voice are unknown -- null, which is unknown rather
 * than unchanged -- not that the take is older than version 1. There is no version 0.
 */
export type Origin = "imported" | "generated";

export type VoicelineVersion = {
  file: string;
  version: number;
  isCurrent: boolean;
  origin: Origin;
  lineId: string;
  voice: string;
  voiceId: string | null;
  modelId: string | null;
  seed: number | null;
  characters: number | null;
  /** What ElevenLabs actually charged, which is not the character count. See billing.ts. */
  credits: number | null;
  bytes: number;
  settings: VoiceSettings | null;
  /**
   * sha-256 of the exact text sent, and the dictionary version applied to it.
   *
   * Together these are what makes staleness answerable: the hash moves when the regex rules
   * or the corpus text change, the version moves when the lexicon does, and a phoneme rule
   * changes only the second. null on every row written before the two columns existed, and
   * on every imported take - which means unknown, not unchanged.
   */
  spokenHash: string | null;
  dictionaryVersion: string | null;
  createdAt: string;
  createdBy: string | null;
  /** Resolved for display; null once the account is deleted, as the row survives it. */
  createdByName: string | null;
};

export type NewVersion = {
  file: string;
  version: number;
  origin: Origin;
  lineId: string;
  voice: string;
  /** The narrator that read this take's stage directions, or null for a single-voice take. */
  narratorVoice?: string | null;
  bytes: number;
  voiceId?: string | null;
  modelId?: string | null;
  seed?: number | null;
  characters?: number | null;
  credits?: number | null;
  /** What was sent: a dialogue take carries only `stability`. */
  settings?: VoiceSettings | Pick<VoiceSettings, "stability"> | null;
  spokenHash?: string | null;
  dictionaryVersion?: string | null;
  /**
   * Whether the request carried a lead-in, and how many seconds were cut off the front.
   *
   * `leadIn` true with `leadInSec` null is a take that asked for one and did not get it -
   * the model ignored the tag, or ffmpeg was unavailable - so it still has the ramp-up and
   * a throat clear in it. See lib/generation/leadin.ts.
   */
  leadIn?: boolean;
  leadInSec?: number | null;
  createdBy?: string | null;
};

// bigint and bigserial come back as strings from pg (they can exceed Number.MAX_SAFE_INTEGER
// in general, though not here), so they are cast in SQL rather than parsed in TypeScript.
const COLUMNS = `
  v."file", v."version", v."isCurrent", v."origin", v."lineId", v."voice",
  v."voiceId", v."modelId", v."seed"::bigint::float8 as "seed", v."characters", v."credits",
  v."bytes"::float8 as "bytes", v."settings", v."spokenHash", v."dictionaryVersion",
  v."createdAt", v."createdBy", u."name" as "createdByName"`;

export async function listVersions(file: string): Promise<VoicelineVersion[]> {
  const { rows } = await db().query<VoicelineVersion>(
    `select ${COLUMNS}
       from "take" v
       left join "user" u on u."id" = v."createdBy"
      where v."source" = 'quests' and v."file" = $1
      order by v."version" desc`,
    [file],
  );
  return rows;
}

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
    `select t."file", t."version",
            (select count(*) from "take" a
              where a."source" = 'quests' and a."lang" = t."lang" and a."file" = t."file")
              as "takes"
       from "take" t
      where t."source" = 'quests' and t."isCurrent"`,
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

/**
 * The version number a new take should get: one past the highest ever used.
 *
 * Past the highest *used*, not the highest surviving, so a number is never reissued.
 * Reusing one would make two different takes share a filename in history and an id in the
 * table, and the older row would win the unique constraint.
 *
 * The first take of a line is version 1. A file with no rows has never been generated, and
 * there is no number standing for the take before that one.
 */
export async function nextVersion(file: string): Promise<number> {
  const { rows } = await db().query<{ next: number }>(
    `select coalesce(max("version"), 0) + 1 as next
       from "take" where "source" = 'quests' and "file" = $1`,
    [file],
  );
  return rows[0]?.next ?? 1;
}

/**
 * The version of the take that is live for this file, or null when it has never been
 * generated.
 *
 * What the bytes in the store are, which is what commitVersion needs to know before it
 * writes over them.
 */
export async function liveVersionOf(file: string): Promise<number | null> {
  const { rows } = await db().query<{ version: number }>(
    `select "version" from "take"
      where "source" = 'quests' and "file" = $1 and "isCurrent"`,
    [file],
  );
  return rows[0]?.version ?? null;
}

export async function recordVersion(version: NewVersion): Promise<void> {
  await db().query(
    `insert into "take"
       ("source", "file", "version", "origin", "lineId", "voice", "bytes",
        "voiceId", "modelId", "seed", "characters", "credits", "settings",
        "spokenHash", "dictionaryVersion", "createdBy", "narratorVoice",
        "leadIn", "leadInSec", "archiveFile")
     values ('quests', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
             $17, $18, $19)`,
    [
      version.file,
      version.version,
      version.origin,
      version.lineId,
      version.voice,
      version.bytes,
      version.voiceId ?? null,
      version.modelId ?? null,
      version.seed ?? null,
      version.characters ?? null,
      version.credits ?? null,
      version.settings ? JSON.stringify(version.settings) : null,
      version.spokenHash ?? null,
      version.dictionaryVersion ?? null,
      version.createdBy ?? null,
      version.narratorVoice ?? null,
      // False rather than null by omission: an inherited or imported take was not made here
      // and never had a lead-in, which is what the column says about it.
      version.leadIn ?? false,
      version.leadInSec ?? null,
      // Where archive.ts put the bytes. Quests names an archived take after its version
      // and always has, so this is not news here -- it is recorded anyway, because a take
      // that says where its own audio is needs nothing worked out about it, and that is
      // what lets one history panel read all three sections.
      `${version.version}.mp3`,
    ],
  );
}

/**
 * Mark one version live.
 *
 * Both statements in one transaction: a partial index enforces at most one current row per
 * file, so clearing and setting must not be separable - between them the file would have no
 * current version, and a concurrent read would report the line as never generated.
 */
export async function setCurrentVersion(file: string, version: number): Promise<void> {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      `update "take" set "isCurrent" = false
        where "source" = 'quests' and "file" = $1 and "isCurrent"`,
      [file],
    );
    await client.query(
      `update "take" set "isCurrent" = true
        where "source" = 'quests' and "file" = $1 and "version" = $2`,
      [file, version],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

