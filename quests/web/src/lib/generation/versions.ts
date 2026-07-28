/**
 * The record of every take: what it was made with, by whom, and which one is live.
 *
 * The disk holds the bytes (archive.ts); this holds what they mean. The two can disagree
 * only by someone deleting files by hand, and listVersions reconciles them on read rather
 * than trusting either alone - offering a restore of a take that is not on disk would fail
 * at the worst moment, after the current file had already been archived.
 */
import { db } from "@/lib/db";

import type { VoiceSettings } from "./config";

export type Origin = "inherited" | "generated";

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
  bytes: number;
  settings: VoiceSettings | null;
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
  bytes: number;
  voiceId?: string | null;
  modelId?: string | null;
  seed?: number | null;
  characters?: number | null;
  settings?: VoiceSettings | null;
  createdBy?: string | null;
};

// bigint and bigserial come back as strings from pg (they can exceed Number.MAX_SAFE_INTEGER
// in general, though not here), so they are cast in SQL rather than parsed in TypeScript.
const COLUMNS = `
  v."file", v."version", v."isCurrent", v."origin", v."lineId", v."voice",
  v."voiceId", v."modelId", v."seed"::bigint::float8 as "seed", v."characters",
  v."bytes"::float8 as "bytes", v."settings", v."createdAt", v."createdBy",
  u."name" as "createdByName"`;

export async function listVersions(file: string): Promise<VoicelineVersion[]> {
  const { rows } = await db().query<VoicelineVersion>(
    `select ${COLUMNS}
       from "voiceline_version" v
       left join "user" u on u."id" = v."createdBy"
      where v."file" = $1
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
       from "voiceline_version" where "file" = any($1::text[])
      group by "file"`,
    [files],
  );
  return new Map(rows.map((row) => [row.file, Number(row.count)]));
}

/**
 * The version number a new take should get: one past the highest ever used.
 *
 * Past the highest *used*, not the highest surviving, so a pruned number is never reissued.
 * Reusing one would make two different takes share a filename in history and an id in the
 * table, and the older row would win the unique constraint.
 */
export async function nextVersion(file: string): Promise<number> {
  const { rows } = await db().query<{ next: number }>(
    `select coalesce(max("version"), -1) + 1 as next
       from "voiceline_version" where "file" = $1`,
    [file],
  );
  return rows[0]?.next ?? 0;
}

export async function hasVersions(file: string): Promise<boolean> {
  const { rows } = await db().query(
    `select 1 from "voiceline_version" where "file" = $1 limit 1`,
    [file],
  );
  return rows.length > 0;
}

export async function recordVersion(version: NewVersion): Promise<void> {
  await db().query(
    `insert into "voiceline_version"
       ("file", "version", "origin", "lineId", "voice", "bytes",
        "voiceId", "modelId", "seed", "characters", "settings", "createdBy")
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
      version.settings ? JSON.stringify(version.settings) : null,
      version.createdBy ?? null,
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
      `update "voiceline_version" set "isCurrent" = false
        where "file" = $1 and "isCurrent"`,
      [file],
    );
    await client.query(
      `update "voiceline_version" set "isCurrent" = true
        where "file" = $1 and "version" = $2`,
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

export async function deleteVersions(file: string, versions: number[]): Promise<void> {
  if (versions.length === 0) return;
  await db().query(
    `delete from "voiceline_version" where "file" = $1 and "version" = any($2::int[])`,
    [file, versions],
  );
}
